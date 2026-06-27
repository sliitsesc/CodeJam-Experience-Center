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

## Try it

**From the dashboard:** click Toggle. The Uno's on-board LED flips. The event
feed shows a new entry with a blue `dashboard` badge.

**From an external service** (simulate a 3rd-party API call):

```bash
curl -X POST http://localhost:3001/api/lights/1/toggle \
  -H "Content-Type: application/json" \
  -H "X-Source: external-api" \
  -d '{"state":"on"}'
```

The dashboard updates instantly — orange `external-api` badge, light turns on,
real LED follows.

---

## API

| Method | Path                       | What it does |
|--------|----------------------------|--------------|
| GET    | `/api/lights`              | Current state of all lights |
| GET    | `/api/events`              | Last 200 trigger events |
| POST   | `/api/lights/:id/toggle`   | Toggle or set. Body: `{"state":"on"\|"off"}`. Header `X-Source: your-name` tags the trigger. |
| GET    | `/ws`                      | WebSocket — pushes live event updates |
| GET    | `/api/health`              | Health + bridge status |

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
