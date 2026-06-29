# Arduino Lighting Control Center

A web dashboard that turns an **Arduino Uno** LED on/off and shows a live feed
of **who triggered it** (you, an external app, an automation, etc.).

---

## How it works

```
┌──────────────┐ HTTP+WS  ┌──────────────┐   TCP    ┌──────────────┐   USB    ┌────────────┐
│  Dashboard   │─────────►│   Backend    │─────────►│   Bridge     │─────────►│  Arduino   │
│  (Docker)    │          │  (Docker)    │  :5331   │  (native)    │  serial  │    Uno     │
└──────────────┘          └──────────────┘          └──────────────┘          └────────────┘
                                  ▲
                          POST /api/lights/1/toggle
                                  │
                           Any external service
```

**4 pieces, each with one job:**

1. **Dashboard** — single web page. Shows lights + live event feed.
2. **Backend** — REST API + WebSocket. Records every trigger with its source.
3. **Bridge** — tiny TCP↔USB proxy that owns the Arduino's serial port.
   (Runs natively because Docker on macOS can't access USB.)
4. **Arduino Uno** — runs the sketch in `arduino/`. Listens for `1` (on) or
   `0` (off) over USB serial; drives the built-in LED on pin 13.

When you click Toggle:
**dashboard → backend → bridge → Uno LED flips → event broadcast back over WebSocket → dashboard updates instantly.**

When a 3rd party sends a POST request: same flow, but the event shows up
tagged with an orange `external-api` badge so you can see it wasn't you.

---

## First-time setup

1. **Upload the sketch.** Open `arduino/light_controller/light_controller.ino`
   in the Arduino IDE → Board = Uno → pick your USB port → click Upload.

2. Make sure **Docker Desktop** is running and you have **Node.js** installed.

That's it.

---

## Run it

```bash
cd /Users/movindu/arduino-control-center
./start.sh
```

That one command:
- Finds your Arduino's serial port automatically
- Starts the USB bridge
- Starts the backend + frontend in Docker

Open the dashboard: **<http://localhost:8080>**

Stop everything: `Ctrl+C` once.

---

## Patterns

| Pattern         | What it does                                |
|-----------------|---------------------------------------------|
| `off`           | LED solid off                                |
| `on`            | LED solid on                                 |
| `blink`         | 1 Hz blink (500 ms on / 500 ms off)          |
| `fast_blink`    | 5 Hz blink                                   |
| `heartbeat`     | Double-pulse, ~1 s cycle                     |
| `strobe`        | 10 Hz strobe                                 |
| `sos`           | Morse SOS                                    |
| `flicker`       | Candle-like random short on/off              |
| `triple_blink`  | Three quick blinks, then a pause             |
| `wave`          | Blink rate ramps fast then slow              |
| `disco`         | Faster, harsher random toggles               |
| `morse_help`    | Morse HELP                                   |

> Re-upload `arduino/light_controller/light_controller.ino` whenever the
> pattern list changes — the new pattern chars (`k t w d m`) need to be
> recognized on the board side.

## Try it

**From the dashboard:** click any pattern pill on the light card. The Uno's
on-board LED switches to that pattern. The event feed shows a new entry with a
blue `dashboard` badge.

**From an external service** (simulate a 3rd-party API call):

```bash
curl -X POST http://localhost:3001/api/lights/1/pattern \
  -H "Content-Type: application/json" \
  -H "X-Source: external-api" \
  -d '{"pattern":"sos"}'
```

The dashboard updates instantly — orange `external-api` badge, the pattern's
pill turns yellow on the card, real LED starts blinking SOS.

---

## Combinations (sound + LED)

A **combo** is a named pair: one sound + one LED pattern. Trigger a combo and
the LED fires on the Arduino while the sound plays on every open dashboard.

Make one from the dashboard: click **+ New combo**, give it a name (e.g.
*Doorbell*), pick a pattern, and choose a sound source:

| Sound source | What you provide |
|---|---|
| **Preset**   | One of `beep`, `chime`, `alarm`, `siren`, `success`, `error` (synthesized in the browser — no network) |
| **Upload file** | An audio file (mp3/wav/ogg/m4a/aac/flac/webm) up to **10 MB**. Stored server-side and reusable across combos. |
| **Direct URL** | Any `.mp3`/`.wav`/`.ogg` URL — the browser plays it with `<audio>` |
| **YouTube**  | Any `youtube.com/watch`, `youtu.be`, or `youtube.com/shorts` URL — played via a hidden YouTube iframe |

Combos are saved server-side (in `/data/combos.json` inside the backend
container, backed by a Docker volume) so they survive restarts and are shared
across every browser hitting the dashboard.

**Sound loops and the LED stays on until you press Stop.** The combo card's
Play button flips to ⏹ Stop while it's running, and a "Now playing" strip with
its own Stop button appears at the top of the section. Pressing Stop turns the
LED off and stops the audio on every connected dashboard.

> Browsers block audio until you interact with the page. If you see a yellow
> **🔊 Enable sound** button in the header after a refresh, click it once.

## API

| Method | Path                        | What it does |
|--------|-----------------------------|--------------|
| GET    | `/api/patterns`             | List of valid pattern names |
| GET    | `/api/sound-presets`        | List of built-in sound preset names |
| GET    | `/api/lights`               | Current state of all lights (includes `pattern`) |
| GET    | `/api/events`               | Last 200 trigger events |
| POST   | `/api/lights/:id/pattern`   | Set a pattern. Body: `{"pattern":"blink"}`. Header `X-Source: your-name` tags the trigger. |
| GET    | `/api/combos`               | List saved combos |
| POST   | `/api/combos`               | Create a combo. Body: `{"name":"Doorbell","pattern":"blink","sound":{"type":"preset","value":"chime"}}` |
| DELETE | `/api/combos/:id`           | Delete a combo |
| POST   | `/api/combos/:idOrName/trigger` | Trigger a saved combo by id or name. LED fires; dashboards loop the sound until stopped. |
| POST   | `/api/combos/stop`          | Stop the active combo: turns the LED off and tells every dashboard to stop the sound. |
| GET    | `/api/sounds`               | List uploaded audio files (metadata only). |
| POST   | `/api/sounds`               | Upload an audio file. Body: `{"name":"foo.mp3","mime":"audio/mpeg","data_base64":"…"}`. Max 10 MB. |
| GET    | `/api/sounds/:id`           | Stream the uploaded file. |
| DELETE | `/api/sounds/:id`           | Delete an uploaded file (refused if a combo references it). |
| GET    | `/ws`                       | WebSocket — pushes live event updates |
| GET    | `/api/health`               | Health + bridge status |

**Trigger a combo from anywhere:**

```bash
curl -X POST http://localhost:3001/api/combos/Doorbell/trigger \
  -H "X-Source: external-api"
```

---

## Common issues

| Symptom | Fix |
|---|---|
| Event card shows ⚠ `arduino unreachable` | The bridge isn't running or can't reach the Uno. Re-run `./start.sh`. |
| `failed to open /dev/cu.usbmodem...` | Close the Arduino IDE's Serial Monitor — it holds the port. |
| Dashboard says `⚠️ backend unreachable` | `docker compose ps` — make sure backend container is up. |
| `no Arduino-like serial port found` | Plug the Uno in. Or pass it manually: `SERIAL_PORT=/dev/cu.xxx ./start.sh` |

---

## Folder layout

```
arduino-control-center/
├── start.sh             ← one-command launcher
├── docker-compose.yml
├── arduino/             ← Arduino Uno sketch
├── bridge/              ← USB ↔ TCP bridge (native, ~70 lines)
├── backend/             ← Express API + WebSocket (Docker)
└── frontend/            ← HTML dashboard + nginx (Docker)
```
