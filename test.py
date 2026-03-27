import collections
import os
import random
import sys
import time
from urllib.parse import urlparse

import joblib
import numpy as np
import requests

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

# Ensure local directory is in path before importing the model class.
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from biofilm_models import HybridBiofilmPredictor


if load_dotenv is not None:
    load_dotenv()
else:
    print("[WARN] python-dotenv is not installed. Skipping .env loading.")

DEFAULT_ESP32_HOST = "192.168.137.155"
DEFAULT_ESP32_PATH = "/status"


def build_sensor_url():
    esp32_value = (
        os.getenv("ESP32_URL")
        or os.getenv("ESP32_IP")
        or os.getenv("ESP32_HOST")
        or DEFAULT_ESP32_HOST
    ).strip()

    if esp32_value.startswith(("http://", "https://")):
        parsed = urlparse(esp32_value)
        path = parsed.path or DEFAULT_ESP32_PATH
        return parsed._replace(path=path).geturl()

    host = esp32_value
    port = os.getenv("ESP32_PORT", "").strip()
    path = os.getenv("ESP32_PATH", DEFAULT_ESP32_PATH).strip() or DEFAULT_ESP32_PATH
    if not path.startswith("/"):
        path = f"/{path}"

    port_segment = f":{port}" if port else ""
    return f"http://{host}{port_segment}{path}"


URL_SENSOR = build_sensor_url()
print(f"[INFO] Sensor endpoint configured as: {URL_SENSOR}")

THINGSPEAK_API_KEY = os.getenv("THINGSPEAK_API_KEY", "YOUR_API_KEY")
THINGSPEAK_URL = f"https://api.thingspeak.com/update?api_key={THINGSPEAK_API_KEY}"

MODEL_PATH = "biofilm_hybrid_model"
SCALER_PATH = "scaler_hybrid.pkl"
SEQUENCE_LENGTH = 10
FEATURES_ORDER = ["ph", "temperature", "humidity", "flow", "turbidity", "tds"]

history_buffer = collections.deque(maxlen=SEQUENCE_LENGTH)

MODEL_LOADED = False
try:
    predictor = HybridBiofilmPredictor()
    predictor.load(MODEL_PATH)
    scaler = joblib.load(SCALER_PATH)
    MODEL_LOADED = True
    print("[OK] Model and scaler loaded successfully.")
except Exception as e:
    print(f"[ERROR] Failed to load model: {e}")
    print("[WARN] Continuing in sensor-data-only mode (risk will be 0 until model is available).")
    predictor = None
    scaler = None

if THINGSPEAK_API_KEY == "YOUR_API_KEY" or not THINGSPEAK_API_KEY:
    print("[WARN] ThingSpeak API key is not set or is using the default value in .env.")


def get_sensor_data():
    try:
        print(f"[INFO] Attempting to fetch data from: {URL_SENSOR}...", end="\r")
        response = requests.get(URL_SENSOR, timeout=5)
        if response.status_code == 200:
            return response.json()

        print(f"\n[ERROR] ESP32 returned status code: {response.status_code}")
    except requests.exceptions.ConnectTimeout:
        print(f"\n[ERROR] Connection timeout: could not reach ESP32 at {URL_SENSOR}. Check the IP and device power.")
    except requests.exceptions.ConnectionError:
        print(f"\n[ERROR] Connection error: network unreachable or ESP32 refused connection at {URL_SENSOR}.")
    except Exception as e:
        print(f"\n[ERROR] Unexpected error fetching sensor data: {e}")

    return None


class Simulator:
    def __init__(self):
        self.ph = 7.0
        self.temp = 30.0
        self.hum = 60.0
        self.flow = 50.0
        self.turb = 5.0
        self.tds = 100.0
        self.steps = 0

    def get_next_reading(self):
        self.ph += random.uniform(-0.1, 0.1)
        self.ph = max(6.0, min(8.5, self.ph))

        self.temp += random.uniform(-0.5, 0.5)
        self.hum += random.uniform(-1, 1)
        self.hum = max(20, min(100, self.hum))
        self.turb = max(0, self.turb + random.uniform(-1, 1))
        self.tds += random.uniform(-5, 5)
        self.tds = max(0, min(1500, self.tds))

        self.steps += 1
        if self.steps > 20:
            self.turb += 0.5

        return {
            "ph": round(self.ph, 2),
            "temperature": round(self.temp, 2),
            "humidity": round(self.hum, 2),
            "flow": round(self.flow, 2),
            "turbidity": round(max(0, self.turb), 2),
            "tds": round(self.tds, 2),
        }


sim = Simulator()
SIMULATION_MODE = False


def send_to_thingspeak(data, risk_val, status_code, ensemble_preds=None):
    payload = {
        "field1": data["ph"],
        "field2": data["temperature"],
        "field3": data["humidity"],
        "field4": data["flow"],
        "field5": data["turbidity"],
        "field6": data["tds"],
        "field7": round(risk_val, 2),
        "field8": status_code,
    }

    try:
        response = requests.post(THINGSPEAK_URL, data=payload, timeout=5)
        if response.status_code == 200:
            print(f"[OK] Sent to ThingSpeak (ID: {response.text}) | Risk: {risk_val:.1f}%")
            if ensemble_preds:
                rf, xgb_p, lstm = ensemble_preds
                rf_val = rf[0] if hasattr(rf, "__getitem__") else rf
                xgb_val = xgb_p[0] if hasattr(xgb_p, "__getitem__") else xgb_p
                lstm_val = lstm[0] if hasattr(lstm, "__getitem__") else lstm
                print(f"   [Ensemble] RF: {rf_val:.1f}% | XGB: {xgb_val:.1f}% | LSTM: {lstm_val:.1f}%")
        else:
            print(f"[WARN] ThingSpeak error: {response.status_code}")
    except Exception as e:
        print(f"[ERROR] ThingSpeak exception: {e}")


print("\n[INFO] Starting Biofilm Risk Monitor (Hybrid Ensemble)...")
INTERVAL_SEC = 16

try:
    while True:
        raw_data = get_sensor_data()

        if raw_data:
            print(f"[INFO] Sensor data: {raw_data}")
            SIMULATION_MODE = False
        else:
            if not SIMULATION_MODE:
                print("[WARN] Sensor offline. Switching to simulation mode.")
                SIMULATION_MODE = True

            raw_data = sim.get_next_reading()
            print(f"[INFO] Simulated: {raw_data}")

        features = [raw_data[f] for f in FEATURES_ORDER]
        history_buffer.append(features)

        risk = 0.0
        status_code = 1
        ensemble_debug = None

        if len(history_buffer) == SEQUENCE_LENGTH and MODEL_LOADED:
            seq_array = np.array(history_buffer)
            seq_scaled = scaler.transform(seq_array)
            input_seq = seq_scaled.reshape(1, SEQUENCE_LENGTH, len(FEATURES_ORDER))

            try:
                pred_val, (p_rf, p_xgb, p_lstm) = predictor.predict(input_seq)
                risk = float(pred_val if np.isscalar(pred_val) else pred_val[0])
                risk = max(0.0, min(100.0, risk))
                ensemble_debug = (p_rf, p_xgb, p_lstm)

                if risk < 40:
                    status_code = 1
                elif risk < 70:
                    status_code = 2
                else:
                    status_code = 3
            except Exception as e:
                print(f"[ERROR] Prediction error: {e}")
        elif not MODEL_LOADED:
            print("[WARN] Model not loaded - skipping prediction. Sensor data is still uploaded.")
            risk = 0
        else:
            print(f"[INFO] Gathering history... ({len(history_buffer)}/{SEQUENCE_LENGTH})")
            risk = 0

        send_to_thingspeak(raw_data, risk, status_code, ensemble_debug)
        time.sleep(INTERVAL_SEC)

except KeyboardInterrupt:
    print("\n[INFO] Stopping...")
    try:
        final_payload = {"field8": 0}
        requests.post(THINGSPEAK_URL, data=final_payload, timeout=2)
        print("Sent shutdown signal (status 0).")
    except Exception:
        pass
    print("Exited.")
