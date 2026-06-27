// Arduino Uno light controller (USB serial).
// Upload via Arduino IDE -> Board: "Arduino Uno", Port: your USB port.
//
// Protocol (one char per command):
//   '1' -> turn LED ON  (responds "ON\n")
//   '0' -> turn LED OFF (responds "OFF\n")
//   '?' -> query state  (responds "ON\n" or "OFF\n")
//
// LED: built-in LED on pin 13. Swap in a relay signal pin if driving mains.

const int LIGHT_PIN = 13;
int lightState = LOW;

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
    if (c == '1') {
      lightState = HIGH;
      digitalWrite(LIGHT_PIN, HIGH);
      Serial.println("ON");
    } else if (c == '0') {
      lightState = LOW;
      digitalWrite(LIGHT_PIN, LOW);
      Serial.println("OFF");
    } else if (c == '?') {
      Serial.println(lightState == HIGH ? "ON" : "OFF");
    }
  }
}
