#include <WiFi.h>
#include <WebServer.h>
#include <DHT.h>
#include <ThingSpeak.h> // Install ThingSpeak Library by MathWorks
#include "secrets.h" // Adjusted path based on file location

/* ================= WIFI ================= */
// Credentials moved to secrets.h
WiFiClient client;

/* ================= WEB ================= */
WebServer server(80);

/* ================= PINS ================= */
#define DHTPIN        2
#define DHTTYPE       DHT11
#define FLOW_PIN      4
#define TURBIDITY_PIN 32
#define TDS_PIN       33

/* ================= OBJECTS ================= */
DHT dht(DHTPIN, DHTTYPE);

/* ================= VALUES ================= */
float temperature = 0;
float humidity = 0;
float phValue = 0;
float turbidityNTU = 0;   // Converted to NTU
float tdsValue_ppm = 0;   // Converted to ppm

/* ================= FLOW ================= */
volatile uint32_t flowPulses = 0;
float flowRate = 0;
unsigned long lastFlowMillis = 0;

/* ================= FLOW ISR ================= */
void IRAM_ATTR flowISR() {
  flowPulses++;
}

/* ================= STATUS API ================= */
void handleStatus() {
  String json = "{";
  json += "\"ph\":"          + String(phValue, 2)       + ",";
  json += "\"temperature\":" + String(temperature, 1)   + ",";
  json += "\"humidity\":"    + String(humidity, 1)       + ",";
  json += "\"flow\":"        + String(flowRate, 2)       + ",";
  json += "\"turbidity\":"   + String(turbidityNTU, 1)  + ",";
  json += "\"tds\":"         + String(tdsValue_ppm, 1);
  json += "}";
  server.send(200, "application/json", json);
}

/* ================= SETUP ================= */
void setup() {
  Serial.begin(115200);

  /* pH UART */
  Serial2.begin(9600, SERIAL_8N1, 16, 17);
  Serial.println("System Starting...");

  /* WiFi */
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Connected");
  Serial.println(WiFi.localIP());

  ThingSpeak.begin(client);

  /* DHT */
  dht.begin();

  /* ADC */
  analogReadResolution(12);

  /* Flow */
  pinMode(FLOW_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(FLOW_PIN), flowISR, RISING);

  /* Web */
  server.on("/status", handleStatus);
  server.begin();

  Serial.println("System Ready");
}

/* ================= LOOP ================= */
void loop() {
  server.handleClient();

  /* ===== pH UART ===== */
  if (Serial2.available()) {
    String data = Serial2.readStringUntil('\n');
    int s = data.indexOf("PH:");
    int e = data.indexOf(",", s);
    if (s != -1 && e != -1) {
      phValue = data.substring(s + 3, e).toFloat();
    }
  }

  /* ===== DHT11 ===== */
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t) && !isnan(h)) {
    temperature = t;
    humidity = h;
  }

  /* ===== Analog - Turbidity (SEN0189) ===== */
  // Raw ADC 0-4095 (12-bit). SEN0189: higher ADC = cleaner water.
  // Approximate: NTU = 3000 * (1 - (adcRaw / 4095.0))
  int rawTurb = analogRead(TURBIDITY_PIN);
  turbidityNTU = max(0.0f, 3000.0f * (1.0f - (rawTurb / 4095.0f)));

  /* ===== Analog - TDS (SEN0244) ===== */
  // Raw ADC -> Voltage -> ppm using empirical formula
  // V = adcRaw * (3.3 / 4095)
  // ppm ≈ (133.42 * V^3 - 255.86 * V^2 + 857.39 * V) * 0.5
  int rawTDS = analogRead(TDS_PIN);
  float voltage = rawTDS * (3.3f / 4095.0f);
  tdsValue_ppm = (133.42f * voltage * voltage * voltage
                - 255.86f * voltage * voltage
                + 857.39f * voltage) * 0.5f;
  tdsValue_ppm = max(0.0f, tdsValue_ppm);

  /* ===== Flow Rate (YF-S201 Hall-effect) ===== */
  // YF-S201 calibration: 7.5 pulses per second = 1 L/min
  // Measure pulses over 1 second window -> divide by 7.5 -> L/min
  if (millis() - lastFlowMillis >= 1000) {
    noInterrupts();
    uint32_t pulses = flowPulses;
    flowPulses = 0;
    interrupts();
    flowRate = pulses / 7.5f;  // Convert pulses/sec to L/min
    lastFlowMillis = millis();
  }

  /* ===== Serial Output ===== */
  Serial.print("pH: ");        Serial.print(phValue, 2);
  Serial.print(" | T: ");      Serial.print(temperature, 1);
  Serial.print(" | H: ");      Serial.print(humidity, 1);
  Serial.print(" | Flow: ");   Serial.print(flowRate, 2); Serial.print(" L/min");
  Serial.print(" | Turb: ");   Serial.print(turbidityNTU, 1); Serial.print(" NTU");
  Serial.print(" | TDS: ");    Serial.println(tdsValue_ppm, 1); // ppm

  /* ===== ThingSpeak Push (DISABLED - Python Script handles this) ===== */
  /* 
  if (millis() % 20000 < 1000) { // Simple non-blocking timer
    ThingSpeak.setField(1, phValue);
    ThingSpeak.setField(2, temperature);
    ThingSpeak.setField(3, humidity);
    ThingSpeak.setField(4, flowRate);
    ThingSpeak.setField(5, turbidityNTU);
    ThingSpeak.setField(6, tdsValue_ppm);
    
    float risk = 0;
    if (phValue < 6.5 || phValue > 8.5) risk += 20;
    if (temperature > 30) risk += 20;
    if (turbidityNTU > 5) risk += 20;
    if (flowRate < 10) risk += 20;
    if (tdsValue_ppm > 500) risk += 20;
    
    ThingSpeak.setField(7, risk);
    ThingSpeak.setField(8, 1); // 1 = Active/Healthy

    int x = ThingSpeak.writeFields(channelID, writeAPIKey);
    if(x == 200){
      Serial.println("Channel update successful.");
    }
    else{
      Serial.println("Problem updating channel. HTTP error code " + String(x));
    }
  }
  */

  delay(1000);
}
