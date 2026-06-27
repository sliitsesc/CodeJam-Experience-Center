#!/usr/bin/env bash
# One-command launcher: starts the native USB bridge + docker compose.
#
# On macOS the bridge has to run natively because Docker Desktop's Linux VM
# has no USB passthrough. This script hides that detail behind a single Ctrl+C.

set -euo pipefail
cd "$(dirname "$0")"

# --- Find the Arduino serial port (auto-detect if not set) ---
if [ -z "${SERIAL_PORT:-}" ]; then
  PORT=$(ls /dev/cu.usbmodem* /dev/cu.usbserial* /dev/cu.wchusbserial* \
            /dev/ttyACM* /dev/ttyUSB* 2>/dev/null | head -n1 || true)
  if [ -z "$PORT" ]; then
    echo "ERROR: no Arduino-like serial port found."
    echo "  Plug the Uno in, or run with: SERIAL_PORT=/dev/cu.xxx ./start.sh"
    exit 1
  fi
  export SERIAL_PORT="$PORT"
fi
echo ">> Using SERIAL_PORT=$SERIAL_PORT"

# --- Install bridge deps once ---
if [ ! -d bridge/node_modules ]; then
  echo ">> Installing bridge dependencies..."
  (cd bridge && npm install)
fi

# --- Launch the bridge in the background ---
echo ">> Starting native USB bridge..."
(cd bridge && SERIAL_PORT="$SERIAL_PORT" node bridge.js) &
BRIDGE_PID=$!

cleanup() {
  echo
  echo ">> Shutting down..."
  kill "$BRIDGE_PID" 2>/dev/null || true
  docker compose down
  exit 0
}
trap cleanup INT TERM

# --- Run docker compose in the foreground ---
echo ">> Starting Docker stack (backend + frontend)..."
echo ">> Dashboard will be at http://localhost:8080"
echo
docker compose up --build

cleanup
