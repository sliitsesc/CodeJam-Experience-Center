// Arduino Uno two-channel LED controller (red + white via relay module).
//
// Wiring
//   Pin 7 -> RED  channel IN
//   Pin 6 -> WHITE channel IN
//   Module 5V/GND to Uno 5V/GND. Light + supply on the relay's NO/COM/NC side.
//
// Most cheap "blue" relay modules are ACTIVE LOW (LOW = relay energized = light on).
// If yours is the other way, flip ACTIVE_LOW below.
//
// Protocol (one command per line, "\n" terminated):
//   <channel><pattern>\n
//     channel : R = red only, W = white only, B = both
//     pattern : 0 1 b f h s o k t w d m   (off, on, blink, fast_blink,
//                                          heartbeat, strobe, sos, flicker,
//                                          triple_blink, wave, disco, morse_help)
//   "?\n" -> query and print current state.
//
// Examples: "Rb\n" red blink, "Wm\n" white morse_help, "B0\n" everything off.

const int RED_PIN   = 7;
const int WHITE_PIN = 6;
const bool ACTIVE_LOW = true;  // flip to false if your relay turns on with HIGH

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

enum Channels {
  CH_RED,
  CH_WHITE,
  CH_BOTH
};

Pattern  currentPattern  = PAT_OFF;
Channels currentChannels = CH_BOTH;

unsigned long patternT0  = 0;
unsigned long randNextT  = 0;
bool          randState  = false;

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

const char* channelsName(Channels c) {
  switch (c) {
    case CH_RED:   return "red";
    case CH_WHITE: return "white";
    case CH_BOTH:  return "both";
  }
  return "?";
}

void writeRelay(int pin, bool on) {
  // Translate logical on/off into the pin level the relay expects.
  digitalWrite(pin, (on ^ ACTIVE_LOW) ? HIGH : LOW);
}

void applyOutputs(bool on) {
  bool wantRed   = (currentChannels == CH_RED   || currentChannels == CH_BOTH) && on;
  bool wantWhite = (currentChannels == CH_WHITE || currentChannels == CH_BOTH) && on;
  writeRelay(RED_PIN,   wantRed);
  writeRelay(WHITE_PIN, wantWhite);
}

void setState(Channels c, Pattern p) {
  currentChannels = c;
  currentPattern  = p;
  patternT0 = millis();
  randNextT = patternT0;
  randState = false;
  Serial.print("STATE ");
  Serial.print(channelsName(c));
  Serial.print(" ");
  Serial.println(patternName(p));
}

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
      static const uint16_t pat[12][2] = {
        {500,500},{400,400},{300,300},{200,200},{100,100},{50,50},
        {50,50},{100,100},{200,200},{300,300},{400,400},{500,500}
      };
      on = stepTable(pat, 12, t % 6200UL);
      break;
    }

    case PAT_MORSE_HELP: {
      static const uint16_t pat[14][2] = {
        {200,200},{200,200},{200,200},{200,600},   // H
        {200,600},                                 // E
        {200,200},{600,200},{200,200},{200,600},   // L
        {200,200},{600,200},{600,200},{200,1400}   // P
      };
      on = stepTable(pat, 14, t % 8800UL);
      break;
    }

    case PAT_FLICKER: {
      if (now >= randNextT) {
        randState = !randState;
        randNextT = now + (randState ? random(40, 160) : random(20, 90));
      }
      on = randState;
      break;
    }

    case PAT_DISCO: {
      if (now >= randNextT) {
        randState = !randState;
        randNextT = now + random(30, 110);
      }
      on = randState;
      break;
    }
  }

  applyOutputs(on);
}

bool parsePattern(char c, Pattern *out) {
  switch (c) {
    case '0': *out = PAT_OFF;          return true;
    case '1': *out = PAT_ON;           return true;
    case 'b': *out = PAT_BLINK;        return true;
    case 'f': *out = PAT_FAST_BLINK;   return true;
    case 'h': *out = PAT_HEARTBEAT;    return true;
    case 's': *out = PAT_STROBE;       return true;
    case 'o': *out = PAT_SOS;          return true;
    case 'k': *out = PAT_FLICKER;      return true;
    case 't': *out = PAT_TRIPLE_BLINK; return true;
    case 'w': *out = PAT_WAVE;         return true;
    case 'd': *out = PAT_DISCO;        return true;
    case 'm': *out = PAT_MORSE_HELP;   return true;
  }
  return false;
}

bool parseChannels(char c, Channels *out) {
  switch (c) {
    case 'R': *out = CH_RED;   return true;
    case 'W': *out = CH_WHITE; return true;
    case 'B': *out = CH_BOTH;  return true;
  }
  return false;
}

char cmdBuf[8];
int  cmdLen = 0;

void handleCommand(const char* s, int n) {
  if (n == 1 && s[0] == '?') {
    Serial.print("STATE ");
    Serial.print(channelsName(currentChannels));
    Serial.print(" ");
    Serial.println(patternName(currentPattern));
    return;
  }
  if (n != 2) {
    Serial.println("ERR expected <channel><pattern> e.g. Rb");
    return;
  }
  Channels nc;
  Pattern  np;
  if (!parseChannels(s[0], &nc)) { Serial.println("ERR bad channel"); return; }
  if (!parsePattern (s[1], &np)) { Serial.println("ERR bad pattern"); return; }
  setState(nc, np);
}

void setup() {
  pinMode(RED_PIN,   OUTPUT);
  pinMode(WHITE_PIN, OUTPUT);
  writeRelay(RED_PIN,   false);
  writeRelay(WHITE_PIN, false);
  randomSeed(analogRead(A0));
  Serial.begin(9600);
  while (!Serial) { ; }
  Serial.println("READY");
}

void loop() {
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (cmdLen > 0) {
        cmdBuf[cmdLen] = 0;
        handleCommand(cmdBuf, cmdLen);
        cmdLen = 0;
      }
    } else if (cmdLen < (int)sizeof(cmdBuf) - 1) {
      cmdBuf[cmdLen++] = c;
    } else {
      cmdLen = 0; // overflow -> drop
    }
  }
  runPattern();
}
