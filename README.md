# Arduino Lighting Control Center

A web dashboard that drives an **Arduino Uno** wired to a **2-channel relay
module** (red + white) with named **patterns** (blink, heartbeat, flicker,
morse…), pairs them with **sound** to make **named combinations** (e.g.
*Doorbell* = chime + triple blink on white), and shows a live feed of **who
triggered what** — you, an external app, an automation.

---

## How it works

```
┌──────────────┐ HTTP+WS  ┌──────────────┐   TCP    ┌──────────────┐   USB    ┌────────────┐
│  Dashboard   │─────────►│   Backend    │─────────►│   Bridge     │─────────►│  Arduino   │
│  (Docker)    │          │  (Docker)    │  :5331   │  (native)    │  serial  │    Uno     │
└──────────────┘          └──────────────┘          └──────────────┘          └────────────┘
                                  ▲
                          POST /api/lights/1/pattern
                                  │
                           Any external service
```

**4 pieces, each with one job:**

1. **Dashboard** — single web page. Patterns, combos, live event feed, audio.
2. **Backend** — REST API + WebSocket. Owns combos and uploaded sounds, records every trigger with its source.
3. **Bridge** — tiny TCP↔USB proxy that owns the Arduino's serial port.
   (Runs natively because Docker on macOS can't access USB.)
4. **Arduino Uno** — runs the sketch in `arduino/`. Listens for a 2-char
   `<channel><pattern>\n` command over USB serial and drives the relay module
   on **pin 6 (red)** and **pin 7 (white)** with a non-blocking state machine.

When you click a pattern: **dashboard → backend → bridge → Uno → LED runs the
pattern → event broadcast back over WebSocket → every dashboard updates
instantly.** Combos trigger an LED pattern *and* play looped audio on every
connected dashboard until stopped.

---

## Wiring

```
Arduino Uno          2-channel relay module       Lights
─────────────        ─────────────────────        ──────
Pin 7   ───────────► IN1  (red channel)   ───────► RED bulb (via NO/COM)
Pin 6   ───────────► IN2  (white channel) ───────► WHITE bulb (via NO/COM)
5V      ───────────► VCC
GND     ───────────► GND
```

The sketch is configured for **active-LOW** modules (the common blue ones):
the relay closes when the Uno pin is driven LOW. If yours is active-HIGH,
flip the `ACTIVE_LOW` constant at the top of the sketch.

> Mechanical relays should be driven on/off — `digitalWrite` only. Don't try
> to PWM them; the contacts will chatter and wear out. If you wired a
> solid-state relay (SSR) and want brightness control, that's a different
> firmware (the current sketch is on/off per channel).

## First-time setup

1. **Upload the sketch.** Open `arduino/light_controller/light_controller.ino`
   in the Arduino IDE → Board = Uno → pick your USB port → click Upload.
   Re-upload whenever the pattern list or protocol changes.

2. Make sure **Docker Desktop** is running and you have **Node.js** installed.

---

## Run it

```bash
cd /Users/movindu/Desktop/arduino-control-center
./start.sh
```

That one command:
- Finds your Arduino's serial port automatically
- Starts the USB bridge
- Starts the backend + frontend in Docker

Open the dashboard: **<http://localhost:8080>**

Stop everything: `Ctrl+C` once.

---

## Channels

Each light has a **channel mask** — pick which relays a pattern targets:

| Channel  | What it does |
|----------|--------------|
| `red`    | Pattern plays on the red relay; white relay stays off |
| `white`  | Pattern plays on the white relay; red relay stays off |
| `both`   | Pattern plays on both relays in sync |

The channel pills on the light card change the mask immediately and re-apply
the current pattern. External API calls can include `"channels": "red"`
(or `white` / `both`); omit it to keep the current mask.

## Patterns

Click a pattern pill on the light card to send it. The active relay(s) — set
by the channel mask above — switch instantly; the event feed shows the
trigger with a blue `dashboard` badge.

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

Trigger from an external service:

```bash
# fire SOS on the red channel
curl -X POST http://localhost:3001/api/lights/1/pattern \
  -H "Content-Type: application/json" -H "X-Source: external-api" \
  -d '{"pattern":"sos","channels":"red"}'
```

The event feed picks it up instantly with an orange `external-api` badge.

---

## Combinations (sound + LED)

A **combo** is a named pair: one sound + one LED pattern. Triggering a combo
fires the LED on the Arduino and loops audio on every connected dashboard
until you press **Stop**.

Make one from the dashboard: click **+ New combo**, give it a name (e.g.
*Doorbell*), pick a **channel** (red / white / both), a pattern, and a sound
source:

| Sound source    | What you provide |
|-----------------|------------------|
| **Preset**      | One of `beep`, `chime`, `alarm`, `siren`, `success`, `error` (synthesized in the browser — no network) |
| **Upload file** | An audio file (mp3/wav/ogg/m4a/aac/flac/webm) up to **10 MB**. Stored server-side and reusable across combos. |
| **Direct URL**  | Any `.mp3`/`.wav`/`.ogg` URL — the browser plays it with `<audio>` |
| **YouTube**     | Any `youtube.com/watch`, `youtu.be`, or `youtube.com/shorts` URL — played via a hidden YouTube iframe |

**Behavior**
- Combo card's Play button flips to **⏹ Stop** while it's running; a "Now
  playing" strip at the top of the section gives you a global stop too.
- Pressing Stop turns the LED **off** and stops audio on every dashboard.
- Sounds **loop** until stopped. Web Audio presets re-trigger on an interval,
  `<audio>` uses `loop=true`, YouTube restarts on the player's `ended` event.
- Manage uploaded files in the **Uploaded sounds** drawer under combos
  (preview / delete). The backend refuses to delete an upload that a combo
  still references.

**Persistence.** Combos and uploaded audio live under `/data` in the backend
container, backed by a named Docker volume, so they survive restarts and are
shared across every browser hitting the dashboard.

**Trigger a combo by name from anywhere:**

```bash
curl -X POST http://localhost:3001/api/combos/Doorbell/trigger \
  -H "X-Source: external-api"
```

> Browsers block audio until you interact with the page. If you see a yellow
> **🔊 Enable sound** button in the header after a refresh, click it once and
> WebSocket-driven playback will work afterwards.

---

## API

| Method | Path                            | What it does |
|--------|---------------------------------|--------------|
| GET    | `/api/health`                   | Health + bridge status |
| GET    | `/api/patterns`                 | List of valid pattern names |
| GET    | `/api/channels`                 | List of valid channel names (`red`, `white`, `both`) |
| GET    | `/api/sound-presets`            | List of built-in sound preset names |
| GET    | `/api/lights`                   | Current state of all lights (includes `pattern`) |
| GET    | `/api/events`                   | Last 200 trigger events |
| POST   | `/api/lights/:id/pattern`       | Set a pattern. Body: `{"pattern":"blink","channels":"red"}` (channels optional, sticky). Header `X-Source: your-name` tags the trigger. |
| GET    | `/api/combos`                   | List saved combos |
| POST   | `/api/combos`                   | Create a combo. Body: `{"name":"Doorbell","pattern":"blink","channels":"both","sound":{"type":"preset","value":"chime"}}` |
| DELETE | `/api/combos/:id`               | Delete a combo |
| POST   | `/api/combos/:idOrName/trigger` | Trigger a saved combo by id or name. LED fires; dashboards loop the sound until stopped. |
| POST   | `/api/combos/stop`              | Stop the active combo: LED → off, dashboards stop the sound. |
| GET    | `/api/sounds`                   | List uploaded audio files (metadata only) |
| POST   | `/api/sounds`                   | Upload an audio file. Body: `{"name":"foo.mp3","mime":"audio/mpeg","data_base64":"…"}`. Max 10 MB. |
| GET    | `/api/sounds/:id`               | Stream an uploaded file |
| DELETE | `/api/sounds/:id`               | Delete an uploaded file (refused if a combo references it) |
| GET    | `/ws`                           | WebSocket — pushes `event`, `combos_changed`, `sounds_changed` messages |

**`sound.type` values:** `preset` · `upload` · `url` · `youtube`. For
`upload`, `sound.value` is the numeric id returned by `POST /api/sounds`.

**`channels` values:** `red` · `white` · `both`. Older combos saved before
this field existed are loaded as `both`.

**Arduino serial protocol (for reference):** each command is two ASCII bytes
followed by `\n`. First byte is the channel (`R`/`W`/`B`); second byte is the
pattern char (`0 1 b f h s o k t w d m`). Example: `Rb\n` = red blink.

---

## Common issues

| Symptom | Fix |
|---|---|
| Event card shows ⚠ `arduino unreachable` | The bridge isn't running or can't reach the Uno. Re-run `./start.sh`. |
| `failed to open /dev/cu.usbmodem...` | Close the Arduino IDE's Serial Monitor — it holds the port. |
| Dashboard says `⚠️ backend unreachable` | `docker compose ps` — make sure backend container is up. |
| `no Arduino-like serial port found` | Plug the Uno in. Or pass it manually: `SERIAL_PORT=/dev/cu.xxx ./start.sh` |
| LED ignores newer patterns (`flicker`, `wave`, `morse_help`, …) | Re-upload the sketch — the new chars (`k t w d m`) need to be recognized board-side. |
| Patterns do nothing after switching to the relay wiring | Re-upload the sketch — the protocol changed to 2-char `<channel><pattern>\n`. |
| Relay clicks but the wrong color lights up | Swap pins 6/7 in the sketch, or swap which channel feeds which bulb. |
| Relay is on when the dashboard says off (or vice versa) | Your module is the opposite polarity — flip `ACTIVE_LOW` at the top of the sketch and re-upload. |
| Sound doesn't play after a page refresh | Click the yellow **🔊 Enable sound** button (browser autoplay policy). |
| Uploads or combos disappear after `docker compose down -v` | `-v` deletes the named volume. Use plain `docker compose down` to keep state. |

---

## Folder layout

```
arduino-control-center/
├── start.sh             ← one-command launcher
├── docker-compose.yml   ← backend + frontend + named volume for /data
├── arduino/             ← Arduino Uno sketch
├── bridge/              ← USB ↔ TCP bridge (native, ~70 lines)
├── backend/             ← Express API + WebSocket (Docker)
└── frontend/            ← HTML dashboard + nginx (Docker)
```
