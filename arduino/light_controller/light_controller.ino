// Arduino Uno LED pattern controller.
// Reads single-char commands over USB serial and plays a non-blocking pattern.
//
// Commands:
//   '0' off
//   '1' on
//   'b' blink       (1 Hz)
//   'f' fast_blink  (5 Hz)
//   'h' heartbeat   (double pulse, 1 s cycle)
//   's' strobe      (10 Hz)
//   'o' sos         (morse SOS)
//   '?' query current pattern

const int LIGHT_PIN = 13;

enum Pattern {
  PAT_OFF,
  PAT_ON,
  PAT_BLINK,
  PAT_FAST_BLINK,
  PAT_HEARTBEAT,
  PAT_STROBE,
  PAT_SOS
};

Pattern currentPattern   = PAT_OFF;
unsigned long patternT0  = 0;

const char* patternName(Pattern p) {
  switch (p) {
    case PAT_OFF:        return "off";
    case PAT_ON:         return "on";
    case PAT_BLINK:      return "blink";
    case PAT_FAST_BLINK: return "fast_blink";
    case PAT_HEARTBEAT:  return "heartbeat";
    case PAT_STROBE:     return "strobe";
    case PAT_SOS:        return "sos";
  }
  return "?";
}

void setPattern(Pattern p) {
  currentPattern = p;
  patternT0      = millis();
  Serial.print("PATTERN ");
  Serial.println(patternName(p));
}

// Non-blocking pattern step. Decide whether the LED should be on right now.
void runPattern() {
  unsigned long t = millis() - patternT0;
  bool on = false;

  switch (currentPattern) {
    case PAT_OFF:        on = false; break;
    case PAT_ON:         on = true;  break;
    case PAT_BLINK:      on = ((t / 500UL) % 2) == 0; break;
    case PAT_FAST_BLINK: on = ((t / 100UL) % 2) == 0; break;
    case PAT_STROBE:     on = ((t /  50UL) % 2) == 0; break;
    case PAT_HEARTBEAT: {
      unsigned long c = t % 1000UL;
      on = (c < 100UL) || (c >= 200UL && c < 300UL);
      break;
    }
    case PAT_SOS: {
      // (on_ms, off_ms) pairs for S O S
      static const uint16_t pat[9][2] = {
        {200, 200}, {200, 200}, {200, 600},   // S . . .  + letter gap
        {600, 200}, {600, 200}, {600, 600},   // O - - -  + letter gap
        {200, 200}, {200, 200}, {200, 1400}   // S . . .  + word gap
      };
      const unsigned long total = 6800UL;
      unsigned long pos = t % total;
      unsigned long acc = 0;
      for (int i = 0; i < 9; i++) {
        if (pos < acc + pat[i][0]) { on = true;  break; }
        acc += pat[i][0];
        if (pos < acc + pat[i][1]) { on = false; break; }
        acc += pat[i][1];
      }
      break;
    }
  }

  digitalWrite(LIGHT_PIN, on ? HIGH : LOW);
}

void setup() {
  pinMode(LIGHT_PIN, OUTPUT);
  digitalWrite(LIGHT_PIN, LOW);
  Serial.begin(9600);
  while (!Serial) { ; }
  Serial.println("READY");
}

void loop() {
  if (Serial.available() > 0) {
    char c = Serial.read();
    switch (c) {
      case '0': setPattern(PAT_OFF);        break;
      case '1': setPattern(PAT_ON);         break;
      case 'b': case 'B': setPattern(PAT_BLINK);      break;
      case 'f': case 'F': setPattern(PAT_FAST_BLINK); break;
      case 'h': case 'H': setPattern(PAT_HEARTBEAT);  break;
      case 's': case 'S': setPattern(PAT_STROBE);     break;
      case 'o': case 'O': setPattern(PAT_SOS);        break;
      case '?':
        Serial.print("PATTERN ");
        Serial.println(patternName(currentPattern));
        break;
    }
  }
  runPattern();
}
