import requests
import time
import random
import joblib
import numpy as np
import collections
from dotenv import load_dotenv
import os
import sys

# Import Hybrid Model Class
# Ensure local directory is in path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from biofilim_models import HybridBiofilmPredictor

# Load Env
load_dotenv()

# Configuration
ESP32_IP = os.getenv("ESP32_IP", "192.168.137.9")
# Handle IP or Full URL from env
if ESP32_IP.startswith("http"):
    URL_SENSOR = ESP32_IP
else:
    URL_SENSOR = f"http://{ESP32_IP}/status"
THINGSPEAK_API_KEY = os.getenv("THINGSPEAK_API_KEY", "YOUR_API_KEY")
THINGSPEAK_URL = f"https://api.thingspeak.com/update?api_key={THINGSPEAK_API_KEY}"

# Model & Scaler
MODEL_PATH = "biofilm_hybrid_model"
SCALER_PATH = "scaler_hybrid.pkl"

MODEL_LOADED = False
try:
    predictor = HybridBiofilmPredictor()
    predictor.load(MODEL_PATH)
    scaler = joblib.load(SCALER_PATH)
    MODEL_LOADED = True
    print("✅ Model & Scaler Loaded Successfully.")
except Exception as e:
    print(f"❌ Error loading model: {e}")
    print("⚠️  Warning: Continuing in sensor-data-only mode (risk will be 0 until model is available).")
    predictor = None
    scaler = None

# History Buffer for Time-Series (Sequence Length = 10)
SEQUENCE_LENGTH = 10
history_buffer = collections.deque(maxlen=SEQUENCE_LENGTH)

# Feature Order: ['ph', 'temperature', 'humidity', 'flow', 'turbidity', 'tds']
FEATURES_ORDER = ['ph', 'temperature', 'humidity', 'flow', 'turbidity', 'tds']

def get_sensor_data():
    try:
        response = requests.get(URL_SENSOR, timeout=2)
        if response.status_code == 200:
            data = response.json()
            return data
    except requests.exceptions.RequestException:
        pass
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
        # Drifting logic (Random Walk)
        self.ph += random.uniform(-0.1, 0.1)
        self.ph = max(6.0, min(8.5, self.ph))
        
        self.temp += random.uniform(-0.5, 0.5)
        self.turb = max(0, self.turb + random.uniform(-1, 1))
        
        self.steps += 1
        # Create drift trend
        if self.steps > 20: self.turb += 0.5 # Simulate clogging
        
        return {
            "ph": round(self.ph, 2),
            "temperature": round(self.temp, 2),
            "humidity": round(self.hum, 2),
            "flow": round(self.flow, 2),
            "turbidity": round(max(0, self.turb), 2),
            "tds": round(self.tds, 2)
        }

sim = Simulator()
SIMULATION_MODE = False # Auto-detect based on connection

def send_to_thingspeak(data, risk_val, status_code, ensemble_preds=None):
    payload = {
        "field1": data['ph'],
        "field2": data['temperature'],
        "field3": data['humidity'],
        "field4": data['flow'],
        "field5": data['turbidity'],
        "field6": data['tds'],
        "field7": round(risk_val, 2),
        "field8": status_code 
    }
    
    try:
        response = requests.post(THINGSPEAK_URL, data=payload, timeout=3)
        if response.status_code == 200:
            print(f"☁️  Sent to ThingSpeak (ID: {response.text}) | Risk: {risk_val:.1f}%")
            if ensemble_preds:
                rf, xgb_p, lstm = ensemble_preds
                # Handle single-value arrays from predictions
                rf_val = rf[0] if hasattr(rf, '__getitem__') else rf
                xgb_val = xgb_p[0] if hasattr(xgb_p, '__getitem__') else xgb_p
                lstm_val = lstm[0] if hasattr(lstm, '__getitem__') else lstm
                print(f"   [Ensemble] RF: {rf_val:.1f}% | XGB: {xgb_val:.1f}% | LSTM: {lstm_val:.1f}%")
        else:
            print(f"⚠️ ThingSpeak Error: {response.status_code}")
    except Exception as e:
        print(f"❌ ThingSpeak Exception: {e}")

# Main Loop
print("\n🔎 Starting Biofilm Risk Monitor (Hybrid Ensemble)...")
INTERVAL_SEC = 16 

try:
    while True:
        raw_data = get_sensor_data()
        
        if raw_data:
            print(f"📡 Sensor Data: {raw_data}")
            SIMULATION_MODE = False
        else:
            if not SIMULATION_MODE:
                print("⚠️ Sensor offline. Switching to SIMULATION MODE.")
                SIMULATION_MODE = True
            
            raw_data = sim.get_next_reading()
            print(f"🤖 Simulated: {raw_data}")

        # Update History
        # Construct feature vector [ph, temp, hum, flow, turb, tds]
        features = [raw_data[f] for f in FEATURES_ORDER]
        history_buffer.append(features)

        risk = 0.0
        status_code = 1 # Healthy
        ensemble_debug = None

        if len(history_buffer) == SEQUENCE_LENGTH and MODEL_LOADED:
            # Prepare Input
            seq_array = np.array(history_buffer)           # Shape (10, 6)
            seq_scaled = scaler.transform(seq_array)       # Scale to [0,1]
            input_seq = seq_scaled.reshape(1, SEQUENCE_LENGTH, len(FEATURES_ORDER))  # (1, 10, 6)

            try:
                pred_val, (p_rf, p_xgb, p_lstm) = predictor.predict(input_seq)
                risk = float(pred_val if np.isscalar(pred_val) else pred_val[0])
                risk = max(0.0, min(100.0, risk))  # Clamp to valid range
                ensemble_debug = (p_rf, p_xgb, p_lstm)

                if risk < 40:   status_code = 1   # Healthy
                elif risk < 70: status_code = 2   # Warning
                else:           status_code = 3   # Critical

            except Exception as e:
                print(f"❌ Prediction Error: {e}")

        elif not MODEL_LOADED:
            print(f"⚠️  Model not loaded — skipping prediction. Sensor data still uploaded.")
            risk = 0
        else:
            print(f"⏳ Gathering history... ({len(history_buffer)}/{SEQUENCE_LENGTH})")
            risk = 0

        # Upload
        send_to_thingspeak(raw_data, risk, status_code, ensemble_debug)
        
        time.sleep(INTERVAL_SEC)

except KeyboardInterrupt:
    print("\n🛑 Stopping...")
    # Send inactive status
    try:
        final_payload = {"field8": 0} # 0 = Inactive
        requests.post(THINGSPEAK_URL, data=final_payload, timeout=2)
        print("Sent Shutdown Signal (Status 0).")
    except:
        pass
    print("Exited.")
