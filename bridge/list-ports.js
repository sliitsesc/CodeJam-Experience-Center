import { SerialPort } from 'serialport';

const ports = await SerialPort.list();
if (ports.length === 0) {
  console.log('No serial ports found. Is the Arduino plugged in?');
  process.exit(0);
}
console.log('Available serial ports:\n');
for (const p of ports) {
  const tag = /usbmodem|usbserial|wchusbserial|Arduino/i.test(`${p.path} ${p.manufacturer || ''}`)
    ? '  <-- likely your Arduino'
    : '';
  console.log(`  ${p.path}${tag}`);
  if (p.manufacturer) console.log(`     manufacturer: ${p.manufacturer}`);
  if (p.productId)    console.log(`     productId:    ${p.productId}`);
}
console.log('\nPick the one that looks like the Arduino, then:');
console.log('  export SERIAL_PORT=<that path>');
console.log('  npm start');
