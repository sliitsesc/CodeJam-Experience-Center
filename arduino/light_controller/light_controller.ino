// Arduino Uno LED pattern controller.
// Reads single-char commands over USB serial and plays a non-blocking pattern.
//
// Commands:
//   '0' off
//   '1' on
//   'b' blink         (1 Hz)
//   'f' fast_blink    (5 Hz)
//   'h' heartbeat     (double pulse, 1 s cycle)
//   's' strobe        (10 Hz)
//   'o' sos           (morse SOS)
//   'k' flicker       (candle-like random)
//   't' triple_blink  (three quick blinks then a pause)
//   'w' wave          (blink rate ramps fast then slow)
//   'd' disco         (fast random toggles)
//   'm' morse_help    (morse HELP)
//   '?' query current pattern

const int LIGHT_PIN = 13;

enum Pattern {
  PAT_OFF,
  PAT_ON,
  PAT_BLINK,
  PAT_FAST_BLINK,
  PAT_HEARTBEAT,
  PAT_STROBE,
  PAT_SOS,
  PAT_FLICKER,
  PAT_TRIPLE_BLINK,
  PAT_WAVE,
  PAT_DISCO,
  PAT_MORSE_HELP
};

Pattern currentPattern   = PAT_OFF;
unsigned long patternT0  = 0;

// State for patterns whose next toggle time is randomized.
unsigned long randNextT = 0;
bool randState = false;

const char* patternName(Pattern p) {
  switch (p) {
    case PAT_OFF:          return "off";
    case PAT_ON:           return "on";
    case PAT_BLINK:        return "blink";
    case PAT_FAST_BLINK:   return "fast_blink";
    case PAT_HEARTBEAT:    return "heartbeat";
    case PAT_STROBE:       return "strobe";
    case PAT_SOS:          return "sos";
    case PAT_FLICKER:      return "flicker";
    case PAT_TRIPLE_BLINK: return "triple_blink";
    case PAT_WAVE:         return "wave";
    case PAT_DISCO:        return "disco";
    case PAT_MORSE_HELP:   return "morse_help";
  }
  return "?";
}

void setPattern(Pattern p) {
  currentPattern = p;
  patternT0      = millis();
  randNextT      = patternT0;
  randState      = false;
  Serial.print("PATTERN ");
  Serial.println(patternName(p));
}

// Walk a (on_ms, off_ms) timing table and decide LED state at position `pos`.
bool stepTable(const uint16_t (*table)[2], int n, unsigned long pos) {
  unsigned long acc = 0;
  for (int i = 0; i < n; i++) {
    if (pos < acc + table[i][0]) return true;
    acc += table[i][0];
    if (pos < acc + table[i][1]) return false;
    acc += table[i][1];
  }
  return false;
}

void runPattern() {
  unsigned long now = millis();
  unsigned long t = now - patternT0;
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
      static const uint16_t pat[9][2] = {
        {200, 200}, {200, 200}, {200, 600},
        {600, 200}, {600, 200}, {600, 600},
        {200, 200}, {200, 200}, {200, 1400}
      };
      on = stepTable(pat, 9, t % 6800UL);
      break;
    }

    case PAT_TRIPLE_BLINK: {
      static const uint16_t pat[3][2] = {{80, 80}, {80, 80}, {80, 600}};
      on = stepTable(pat, 3, t % 1000UL);
      break;
    }

    case PAT_WAVE: {
      // 12-step ramp: period drops 500→50 ms, then climbs back. ~3.1 s cycle.
      static const uint16_t pat[12][2] = {
        {500,500},{400,400},{300,300},{200,200},{100,100},{50,50},
        {50,50},{100,100},{200,200},{300,300},{400,400},{500,500}
      };
      on = stepTable(pat, 12, t % 6200UL);
      break;
    }

    case PAT_MORSE_HELP: {
      // unit = 200 ms. H E L P with proper morse spacing.
      static const uint16_t pat[14][2] = {
        // H = . . . .
        {200,200},{200,200},{200,200},{200,600},
        // E = .
        {200,600},
        // L = . - . .
        {200,200},{600,200},{200,200},{200,600},
        // P = . - - .
        {200,200},{600,200},{600,200},{200,1400}
      };
      on = stepTable(pat, 14, t % 8800UL);
      break;
    }

    case PAT_FLICKER: {
      // Candle-like: short random on/off bursts.
      if (now >= randNextT) {
        randState = !randState;
        randNextT = now + (randState ? random(40, 160) : random(20, 90));
      }
      on = randState;
      break;
    }

    case PAT_DISCO: {
      // Faster, harsher random toggling than flicker.
      if (now >= randNextT) {
        randState = !randState;
        randNextT = now + random(30, 110);
      }
      on = randState;
      break;
    }
  }

  digitalWrite(LIGHT_PIN, on ? HIGH : LOW);
}

void setup() {
  pinMode(LIGHT_PIN, OUTPUT);
  digitalWrite(LIGHT_PIN, LOW);
  randomSeed(analogRead(A0));
  Serial.begin(9600);
  while (!Serial) { ; }
  Serial.println("READY");
}

void loop() {
  if (Serial.available() > 0) {
    char c = Serial.read();
    switch (c) {
      case '0': setPattern(PAT_OFF);          break;
      case '1': setPattern(PAT_ON);           break;
      case 'b': case 'B': setPattern(PAT_BLINK);        break;
      case 'f': case 'F': setPattern(PAT_FAST_BLINK);   break;
      case 'h': case 'H': setPattern(PAT_HEARTBEAT);    break;
      case 's': case 'S': setPattern(PAT_STROBE);       break;
      case 'o': case 'O': setPattern(PAT_SOS);          break;
      case 'k': case 'K': setPattern(PAT_FLICKER);      break;
      case 't': case 'T': setPattern(PAT_TRIPLE_BLINK); break;
      case 'w': case 'W': setPattern(PAT_WAVE);         break;
      case 'd': case 'D': setPattern(PAT_DISCO);        break;
      case 'm': case 'M': setPattern(PAT_MORSE_HELP);   break;
      case '?':
        Serial.print("PATTERN ");
        Serial.println(patternName(currentPattern));
        break;
    }
  }
  runPattern();
}
