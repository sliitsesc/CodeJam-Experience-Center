import express from 'express';
import cors from 'cors';
import http from 'http';
import net from 'net';
import { WebSocketServer } from 'ws';

const PORT       = Number(process.env.PORT) || 3001;
const SERIAL_URL = process.env.SERIAL_URL || 'tcp://host.docker.internal:5331';

// Pattern name -> single-char command sent to the Arduino.
const PATTERN_MAP = {
  off:         '0',
  on:          '1',
  blink:       'b',
  fast_blink:  'f',
  heartbeat:   'h',
  strobe:      's',
  sos:         'o',
};
const PATTERNS = Object.keys(PATTERN_MAP);

const lights = new Map();
lights.set(1, { id: 1, name: 'Main LED', pattern: 'off' });

const MAX_EVENTS = 200;
const events = [];
let nextEventId = 1;

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

function sendChar(ch) {
  if (!bridgeReady || !bridgeSocket) return false;
  try {
    bridgeSocket.write(ch);
    return true;
  } catch (e) {
    console.error('[bridge] write failed:', e.message);
    return false;
  }
}

const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, bridge: { ready: bridgeReady, url: SERIAL_URL } });
});

app.get('/api/patterns', (req, res) => {
  res.json(PATTERNS);
});

app.get('/api/lights', (req, res) => {
  res.json(Array.from(lights.values()));
});

app.get('/api/events', (req, res) => {
  res.json([...events].reverse());
});

app.post('/api/lights/:id/pattern', (req, res) => {
  const id = Number(req.params.id);
  const light = lights.get(id);
  if (!light) return res.status(404).json({ error: 'light not found' });

  const pattern = req.body?.pattern;
  if (!pattern || !(pattern in PATTERN_MAP)) {
    return res.status(400).json({ error: 'invalid pattern', valid: PATTERNS });
  }

  const source   = req.header('X-Source') || req.body?.source || 'unknown';
  const sourceIp = req.ip;

  const arduinoOk = sendChar(PATTERN_MAP[pattern]);
  light.pattern = pattern;

  const event = {
    id: nextEventId++,
    light_id: id,
    pattern,
    source,
    source_ip: sourceIp,
    arduino_ok: arduinoOk ? 1 : 0,
    created_at: new Date().toISOString(),
  };
  events.push(event);
  if (events.length > MAX_EVENTS) events.shift();

  broadcast({ type: 'event', event, light });
  console.log(`[trigger] light=${id} pattern=${pattern} source=${source} ip=${sourceIp} arduino=${arduinoOk}`);

  res.json({ ok: true, light, event });
});

connectBridge();
server.listen(PORT, () => {
  console.log(`Backend listening on :${PORT}`);
});
