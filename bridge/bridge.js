// USB <-> TCP bridge. Owns the Arduino's USB serial port and exposes it as
// a TCP socket so the dockerized backend can talk to it via host.docker.internal.
//
// Run on the host (macOS) with:
//   SERIAL_PORT=/dev/cu.usbmodem14101 npm start

import net from 'net';
import { SerialPort, ReadlineParser } from 'serialport';

const SERIAL_PORT = process.env.SERIAL_PORT ;
const BAUD_RATE   = Number(process.env.BAUD_RATE) || 9600;
const TCP_PORT    = Number(process.env.TCP_PORT) || 5331;

if (!SERIAL_PORT) {
  console.error('ERROR: SERIAL_PORT env var is required.');
  console.error('       Run `npm run list-ports` to find your Arduino.');
  process.exit(1);
}

let port = null;
let serialReady = false;
let activeClient = null;

function openSerial() {
  port = new SerialPort({ path: SERIAL_PORT, baudRate: BAUD_RATE, autoOpen: false });
  const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

  parser.on('data', (line) => {
    const text = line.trim();
    if (text) console.log(`[arduino] >> ${text}`);
    if (activeClient && !activeClient.destroyed) activeClient.write(line + '\n');
  });

  port.on('open',  () => { serialReady = true;  console.log(`[serial] connected ${SERIAL_PORT} @ ${BAUD_RATE}`); });
  port.on('close', () => { serialReady = false; console.log('[serial] closed — retrying in 5s'); setTimeout(openSerial, 5000); });
  port.on('error', (e) => console.error('[serial] error:', e.message));

  port.open((err) => {
    if (err) {
      console.error(`[serial] failed to open ${SERIAL_PORT}: ${err.message}`);
      setTimeout(openSerial, 5000);
    }
  });
}

const server = net.createServer((sock) => {
  console.log(`[tcp] client connected from ${sock.remoteAddress}`);
  if (activeClient && !activeClient.destroyed) {
    console.log('[tcp] replacing previous client');
    activeClient.destroy();
  }
  activeClient = sock;

  sock.on('data', (chunk) => {
    if (!serialReady || !port) {
      console.warn('[tcp] data received but serial not ready');
      return;
    }
    port.write(chunk);
  });
  sock.on('close', () => {
    console.log('[tcp] client disconnected');
    if (activeClient === sock) activeClient = null;
  });
  sock.on('error', (e) => console.error('[tcp] client error:', e.message));
});

server.listen(TCP_PORT, '0.0.0.0', () => {
  console.log(`[tcp] bridge listening on :${TCP_PORT}`);
  console.log(`[tcp] backend should connect to tcp://host.docker.internal:${TCP_PORT}`);
});

openSerial();
