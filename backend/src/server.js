import express from 'express';
import cors from 'cors';
import http from 'http';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { WebSocketServer } from 'ws';

const PORT       = Number(process.env.PORT) || 3001;
const SERIAL_URL = process.env.SERIAL_URL || 'tcp://host.docker.internal:5331';
const DATA_DIR   = process.env.DATA_DIR   || '/data';
const COMBOS_FILE = path.join(DATA_DIR, 'combos.json');
const SOUNDS_DIR  = path.join(DATA_DIR, 'sounds');
const SOUNDS_FILE = path.join(DATA_DIR, 'sounds.json');
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB raw audio

const MIME_TO_EXT = {
  'audio/mpeg': 'mp3',
  'audio/mp3':  'mp3',
  'audio/wav':  'wav',
  'audio/x-wav':'wav',
  'audio/wave': 'wav',
  'audio/ogg':  'ogg',
  'audio/webm': 'webm',
  'audio/aac':  'aac',
  'audio/mp4':  'm4a',
  'audio/x-m4a':'m4a',
  'audio/flac': 'flac',
};

// Pattern name -> single-char command sent to the Arduino (second byte).
const PATTERN_MAP = {
  off:          '0',
  on:           '1',
  blink:        'b',
  fast_blink:   'f',
  heartbeat:    'h',
  strobe:       's',
  sos:          'o',
  flicker:      'k',
  triple_blink: 't',
  wave:         'w',
  disco:        'd',
  morse_help:   'm',
};
const PATTERNS = Object.keys(PATTERN_MAP);

// Channel name -> single-char command sent to the Arduino (first byte).
// 'red' lights only the red relay, 'white' only the white, 'both' both.
const CHANNEL_MAP = { red: 'R', white: 'W', both: 'B' };
const CHANNELS    = Object.keys(CHANNEL_MAP);

// Sound presets are synthesized in the browser via Web Audio API; the backend
// only stores the preset name. The frontend knows how to play them.
const SOUND_PRESETS = ['beep', 'chime', 'alarm', 'siren', 'success', 'error'];
const SOUND_TYPES   = ['preset', 'url', 'youtube', 'upload'];

const lights = new Map();
lights.set(1, { id: 1, name: 'Main Light', pattern: 'off', channels: 'both' });

const MAX_EVENTS = 200;
const events = [];
let nextEventId = 1;

// id -> combo. Persisted to disk so combos survive restarts.
const combos = new Map();
let nextComboId = 1;

// id -> sound metadata. The actual file lives in SOUNDS_DIR/<id>.<ext>.
const sounds = new Map();
let nextSoundId = 1;

function loadCombos() {
  try {
    if (!fs.existsSync(COMBOS_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(COMBOS_FILE, 'utf8'));
    for (const c of raw.combos || []) {
      // Backfill: older combos pre-date the channel concept.
      if (!c.channels) c.channels = 'both';
      combos.set(c.id, c);
      if (c.id >= nextComboId) nextComboId = c.id + 1;
    }
    console.log(`[combos] loaded ${combos.size} from ${COMBOS_FILE}`);
  } catch (e) {
    console.error('[combos] load failed:', e.message);
  }
}

function saveCombos() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const payload = { combos: Array.from(combos.values()) };
    fs.writeFileSync(COMBOS_FILE, JSON.stringify(payload, null, 2));
  } catch (e) {
    console.error('[combos] save failed:', e.message);
  }
}

function loadSounds() {
  try {
    if (!fs.existsSync(SOUNDS_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(SOUNDS_FILE, 'utf8'));
    for (const s of raw.sounds || []) {
      sounds.set(s.id, s);
      if (s.id >= nextSoundId) nextSoundId = s.id + 1;
    }
    console.log(`[sounds] loaded ${sounds.size} from ${SOUNDS_FILE}`);
  } catch (e) {
    console.error('[sounds] load failed:', e.message);
  }
}

function saveSounds() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const payload = { sounds: Array.from(sounds.values()) };
    fs.writeFileSync(SOUNDS_FILE, JSON.stringify(payload, null, 2));
  } catch (e) {
    console.error('[sounds] save failed:', e.message);
  }
}

function soundFilePath(s) {
  return path.join(SOUNDS_DIR, `${s.id}.${s.ext}`);
}

function findComboByName(name) {
  const needle = String(name || '').toLowerCase();
  for (const c of combos.values()) {
    if (c.name.toLowerCase() === needle) return c;
  }
  return null;
}

let bridgeSocket = null;
let bridgeReady  = false;
let recvBuf = '';

function connectBridge() {
  const url = new URL(SERIAL_URL);
  const host = url.hostname;
  const port = Number(url.port) || 5331;

  console.log(`[bridge] connecting to tcp://${host}:${port}...`);
  bridgeSocket = net.createConnection({ host, port });

  bridgeSocket.on('connect', () => {
    bridgeReady = true;
    console.log(`[bridge] connected ${host}:${port}`);
  });
  bridgeSocket.on('close', () => {
    bridgeReady = false;
    console.log('[bridge] disconnected — retrying in 5s');
    setTimeout(connectBridge, 5000);
  });
  bridgeSocket.on('error', (e) => console.error('[bridge] error:', e.message));
  bridgeSocket.on('data', (chunk) => {
    recvBuf += chunk.toString();
    let i;
    while ((i = recvBuf.indexOf('\n')) >= 0) {
      const line = recvBuf.slice(0, i).trim();
      recvBuf = recvBuf.slice(i + 1);
      if (line) console.log(`[arduino] >> ${line}`);
    }
  });
}

// Sends "<channel><pattern>\n" to the Arduino. Returns false if the bridge
// is down so the caller can record arduino_ok=0.
function sendCommand(channels, pattern) {
  if (!bridgeReady || !bridgeSocket) return false;
  const ch  = CHANNEL_MAP[channels];
  const pat = PATTERN_MAP[pattern];
  if (!ch || !pat) return false;
  try {
    bridgeSocket.write(`${ch}${pat}\n`);
    return true;
  } catch (e) {
    console.error('[bridge] write failed:', e.message);
    return false;
  }
}

const app = express();
app.set('trust proxy', true);
app.use(cors());
// Uploads come in as base64 JSON, so the limit must comfortably cover them.
app.use(express.json({ limit: '20mb' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

// Fires a pattern on a light, records an event, and broadcasts it.
// If `combo` is supplied, it's attached so dashboards can play the sound.
// If `channels` is omitted, the light's current channel mask is kept.
function firePattern({ lightId, pattern, channels, source, sourceIp, combo = null }) {
  const light = lights.get(lightId);
  if (!light) return { error: 'light not found', status: 404 };
  if (!(pattern in PATTERN_MAP)) {
    return { error: 'invalid pattern', valid: PATTERNS, status: 400 };
  }
  const ch = channels || light.channels || 'both';
  if (!(ch in CHANNEL_MAP)) {
    return { error: 'invalid channels', valid: CHANNELS, status: 400 };
  }

  const arduinoOk = sendCommand(ch, pattern);
  light.pattern  = pattern;
  light.channels = ch;

  const event = {
    id: nextEventId++,
    light_id: lightId,
    pattern,
    channels: ch,
    source,
    source_ip: sourceIp,
    arduino_ok: arduinoOk ? 1 : 0,
    combo: combo ? { id: combo.id, name: combo.name, sound: combo.sound, channels: ch } : null,
    created_at: new Date().toISOString(),
  };
  events.push(event);
  if (events.length > MAX_EVENTS) events.shift();

  broadcast({ type: 'event', event, light });
  console.log(
    `[trigger] light=${lightId} channels=${ch} pattern=${pattern} source=${source} ip=${sourceIp} arduino=${arduinoOk}` +
    (combo ? ` combo=${combo.name}` : '')
  );
  return { ok: true, light, event };
}

function validateCombo(body) {
  const name = String(body?.name || '').trim();
  if (!name) return { error: 'name is required' };
  if (name.length > 60) return { error: 'name too long (max 60)' };

  const pattern = body?.pattern;
  if (!pattern || !(pattern in PATTERN_MAP)) {
    return { error: 'invalid pattern', valid: PATTERNS };
  }

  const channels = body?.channels || 'both';
  if (!(channels in CHANNEL_MAP)) {
    return { error: 'invalid channels', valid: CHANNELS };
  }

  const sound = body?.sound;
  if (!sound || typeof sound !== 'object') return { error: 'sound is required' };
  if (!SOUND_TYPES.includes(sound.type)) {
    return { error: 'invalid sound.type', valid: SOUND_TYPES };
  }
  const value = String(sound.value || '').trim();
  if (!value) return { error: 'sound.value is required' };

  if (sound.type === 'preset' && !SOUND_PRESETS.includes(value)) {
    return { error: 'unknown sound preset', valid: SOUND_PRESETS };
  }
  if (sound.type === 'url' || sound.type === 'youtube') {
    try { new URL(value); } catch { return { error: 'sound.value must be a valid URL' }; }
  }
  if (sound.type === 'upload') {
    const soundId = Number(value);
    if (!Number.isFinite(soundId) || !sounds.has(soundId)) {
      return { error: 'sound.value must reference an uploaded sound id' };
    }
  }
  return { ok: true, name, pattern, channels, sound: { type: sound.type, value } };
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, bridge: { ready: bridgeReady, url: SERIAL_URL } });
});

app.get('/api/patterns', (req, res) => {
  res.json(PATTERNS);
});

app.get('/api/channels', (req, res) => {
  res.json(CHANNELS);
});

app.get('/api/sound-presets', (req, res) => {
  res.json(SOUND_PRESETS);
});

app.get('/api/lights', (req, res) => {
  res.json(Array.from(lights.values()));
});

app.get('/api/events', (req, res) => {
  res.json([...events].reverse());
});

app.post('/api/lights/:id/pattern', (req, res) => {
  const id = Number(req.params.id);
  const pattern = req.body?.pattern;
  if (!pattern || !(pattern in PATTERN_MAP)) {
    return res.status(400).json({ error: 'invalid pattern', valid: PATTERNS });
  }
  const channels = req.body?.channels; // optional — sticky if absent
  if (channels !== undefined && !(channels in CHANNEL_MAP)) {
    return res.status(400).json({ error: 'invalid channels', valid: CHANNELS });
  }
  const source = req.header('X-Source') || req.body?.source || 'unknown';
  const result = firePattern({ lightId: id, pattern, channels, source, sourceIp: req.ip });
  if (result.error) return res.status(result.status || 400).json({ error: result.error, valid: result.valid });
  res.json(result);
});

app.get('/api/sounds', (req, res) => {
  // Don't expose internal paths; just enough for the dashboard.
  res.json(Array.from(sounds.values()).map(s => ({
    id: s.id, name: s.name, mime: s.mime, ext: s.ext, size: s.size, created_at: s.created_at,
  })));
});

app.post('/api/sounds', (req, res) => {
  const name = String(req.body?.name || '').trim();
  const mime = String(req.body?.mime || '').toLowerCase();
  const data = String(req.body?.data_base64 || '');
  if (!name)            return res.status(400).json({ error: 'name is required' });
  if (name.length > 80) return res.status(400).json({ error: 'name too long (max 80)' });
  if (!mime || !MIME_TO_EXT[mime]) {
    return res.status(400).json({ error: 'unsupported audio mime type', supported: Object.keys(MIME_TO_EXT) });
  }
  if (!data) return res.status(400).json({ error: 'data_base64 is required' });

  let buf;
  try { buf = Buffer.from(data, 'base64'); }
  catch { return res.status(400).json({ error: 'invalid base64 data' }); }
  if (buf.length === 0)             return res.status(400).json({ error: 'empty upload' });
  if (buf.length > MAX_UPLOAD_BYTES) return res.status(413).json({ error: `file too large (max ${MAX_UPLOAD_BYTES} bytes)` });

  const ext = MIME_TO_EXT[mime];
  const sound = {
    id: nextSoundId++,
    name, mime, ext,
    size: buf.length,
    created_at: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(SOUNDS_DIR, { recursive: true });
    fs.writeFileSync(soundFilePath(sound), buf);
  } catch (e) {
    return res.status(500).json({ error: 'failed to write file: ' + e.message });
  }
  sounds.set(sound.id, sound);
  saveSounds();
  broadcast({ type: 'sounds_changed' });
  res.status(201).json(sound);
});

app.get('/api/sounds/:id', (req, res) => {
  const id = Number(req.params.id);
  const s = sounds.get(id);
  if (!s) return res.status(404).json({ error: 'sound not found' });
  const fp = soundFilePath(s);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'sound file missing on disk' });
  res.setHeader('Content-Type', s.mime);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  fs.createReadStream(fp).pipe(res);
});

app.delete('/api/sounds/:id', (req, res) => {
  const id = Number(req.params.id);
  const s = sounds.get(id);
  if (!s) return res.status(404).json({ error: 'sound not found' });

  // Refuse to delete a sound that a combo still points at.
  const usedBy = Array.from(combos.values()).filter(
    c => c.sound?.type === 'upload' && Number(c.sound.value) === id
  );
  if (usedBy.length > 0) {
    return res.status(409).json({
      error: 'sound is used by ' + usedBy.length + ' combo(s)',
      combo_names: usedBy.map(c => c.name),
    });
  }

  try { fs.unlinkSync(soundFilePath(s)); } catch {}
  sounds.delete(id);
  saveSounds();
  broadcast({ type: 'sounds_changed' });
  res.json({ ok: true });
});

app.get('/api/combos', (req, res) => {
  res.json(Array.from(combos.values()));
});

app.post('/api/combos', (req, res) => {
  const v = validateCombo(req.body);
  if (v.error) return res.status(400).json({ error: v.error, valid: v.valid });
  if (findComboByName(v.name)) return res.status(409).json({ error: 'a combo with that name already exists' });

  const combo = {
    id: nextComboId++,
    name: v.name,
    pattern: v.pattern,
    channels: v.channels,
    sound: v.sound,
    created_at: new Date().toISOString(),
  };
  combos.set(combo.id, combo);
  saveCombos();
  broadcast({ type: 'combos_changed' });
  res.status(201).json(combo);
});

// Stop whatever combo (or pattern) is currently playing.
// Sets the light to `off`; the broadcast event tells dashboards to stop sound.
app.post('/api/combos/stop', (req, res) => {
  const lightId = Number(req.body?.light_id) || 1;
  const source  = req.header('X-Source') || req.body?.source || 'unknown';
  const result  = firePattern({ lightId, pattern: 'off', source, sourceIp: req.ip });
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  res.json(result);
});

app.delete('/api/combos/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!combos.has(id)) return res.status(404).json({ error: 'combo not found' });
  combos.delete(id);
  saveCombos();
  broadcast({ type: 'combos_changed' });
  res.json({ ok: true });
});

// Trigger by id OR name — easier for external services.
app.post('/api/combos/:idOrName/trigger', (req, res) => {
  const key = req.params.idOrName;
  const asNum = Number(key);
  let combo = Number.isFinite(asNum) ? combos.get(asNum) : null;
  if (!combo) combo = findComboByName(key);
  if (!combo) return res.status(404).json({ error: 'combo not found' });

  const lightId = Number(req.body?.light_id) || 1;
  const source  = req.header('X-Source') || req.body?.source || 'unknown';
  const result  = firePattern({
    lightId, pattern: combo.pattern, channels: combo.channels, source, sourceIp: req.ip, combo,
  });
  if (result.error) return res.status(result.status || 400).json({ error: result.error, valid: result.valid });
  res.json({ ...result, combo });
});

loadSounds();
loadCombos();
connectBridge();
server.listen(PORT, () => {
  console.log(`Backend listening on :${PORT}`);
});
