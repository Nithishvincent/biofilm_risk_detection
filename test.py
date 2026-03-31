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

# Configurable water system volume for dosage calculations
WATER_VOLUME_LITERS = int(os.getenv("WATER_VOLUME_LITERS", "1000"))

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


# =============================================================================
# TREND-BASED EARLY WARNING SYSTEM
# =============================================================================
class TrendAnalyzer:
    """Analyzes rate-of-change across recent readings to detect early warning
    patterns that precede biofilm formation."""

    # Feature indices in FEATURES_ORDER
    IDX_PH = 0
    IDX_TEMP = 1
    IDX_FLOW = 3
    IDX_TURB = 4
    IDX_TDS = 5

    # Thresholds
    TURB_RISE_PCT = 20       # % increase over window
    FLOW_DROP_PCT = 30       # % decrease over window
    FLOW_STAGNATION = 1.0    # L/min — below this is stagnation
    TDS_RISE_PCT = 15        # % increase over window
    PH_DRIFT = 0.5           # pH units drift
    TEMP_GROWTH_LOW = 25.0   # °C — biofilm growth zone
    TEMP_GROWTH_HIGH = 35.0  # °C

    def __init__(self, min_window=3):
        self.min_window = min_window
        self._prev_temp_in_zone = None

    def analyze(self, buffer):
        """Analyze the history buffer and return a list of trend alerts.

        Each alert is a dict: {level, pattern, message}
          level: 'CRITICAL', 'WARNING', 'ALERT'
        """
        alerts = []
        buf_list = list(buffer)
        if len(buf_list) < self.min_window:
            return alerts

        window = buf_list[-self.min_window:]
        first = window[0]
        last = window[-1]

        # --- Rising Turbidity ---
        if first[self.IDX_TURB] > 0:
            turb_change = ((last[self.IDX_TURB] - first[self.IDX_TURB])
                           / first[self.IDX_TURB]) * 100
            if turb_change >= self.TURB_RISE_PCT:
                alerts.append({
                    "level": "WARNING",
                    "pattern": "RISING_TURBIDITY",
                    "message": f"Turbidity rising {turb_change:.1f}% "
                               f"({first[self.IDX_TURB]:.1f} → {last[self.IDX_TURB]:.1f} NTU)"
                })

        # --- Falling Flow ---
        if first[self.IDX_FLOW] > 0:
            flow_change = ((first[self.IDX_FLOW] - last[self.IDX_FLOW])
                           / first[self.IDX_FLOW]) * 100
            if flow_change >= self.FLOW_DROP_PCT:
                alerts.append({
                    "level": "CRITICAL",
                    "pattern": "FALLING_FLOW",
                    "message": f"Flow dropped {flow_change:.1f}% "
                               f"({first[self.IDX_FLOW]:.1f} → {last[self.IDX_FLOW]:.1f} L/min)"
                })
        if last[self.IDX_FLOW] < self.FLOW_STAGNATION:
            alerts.append({
                "level": "CRITICAL",
                "pattern": "STAGNATION",
                "message": f"Flow rate critically low: {last[self.IDX_FLOW]:.2f} L/min — stagnation risk"
            })

        # --- Rising TDS ---
        if first[self.IDX_TDS] > 0:
            tds_change = ((last[self.IDX_TDS] - first[self.IDX_TDS])
                          / first[self.IDX_TDS]) * 100
            if tds_change >= self.TDS_RISE_PCT:
                alerts.append({
                    "level": "WARNING",
                    "pattern": "RISING_TDS",
                    "message": f"TDS rising {tds_change:.1f}% "
                               f"({first[self.IDX_TDS]:.0f} → {last[self.IDX_TDS]:.0f} ppm) — "
                               f"mineral/nutrient buildup"
                })

        # --- pH Drift ---
        ph_delta = abs(last[self.IDX_PH] - first[self.IDX_PH])
        if ph_delta >= self.PH_DRIFT:
            direction = "rising" if last[self.IDX_PH] > first[self.IDX_PH] else "falling"
            alerts.append({
                "level": "WARNING",
                "pattern": "PH_DRIFT",
                "message": f"pH {direction} rapidly: "
                           f"{first[self.IDX_PH]:.2f} → {last[self.IDX_PH]:.2f} "
                           f"(Δ{ph_delta:.2f} in {self.min_window} readings)"
            })

        # --- Temperature entered growth zone ---
        current_in_zone = (self.TEMP_GROWTH_LOW <= last[self.IDX_TEMP] <= self.TEMP_GROWTH_HIGH)
        prev_in_zone = (self.TEMP_GROWTH_LOW <= first[self.IDX_TEMP] <= self.TEMP_GROWTH_HIGH)
        if current_in_zone and not prev_in_zone:
            alerts.append({
                "level": "ALERT",
                "pattern": "TEMP_GROWTH_ZONE",
                "message": f"Temperature entered biofilm growth zone: "
                           f"{last[self.IDX_TEMP]:.1f}°C (25-35°C range)"
            })

        # --- Combined Red Flag: Flow↓ + Turbidity↑ ---
        flow_dropping = (first[self.IDX_FLOW] > 0 and
                         ((first[self.IDX_FLOW] - last[self.IDX_FLOW])
                          / first[self.IDX_FLOW]) * 100 > 10)
        turb_rising = (first[self.IDX_TURB] > 0 and
                       ((last[self.IDX_TURB] - first[self.IDX_TURB])
                        / first[self.IDX_TURB]) * 100 > 10)
        if flow_dropping and turb_rising:
            alerts.append({
                "level": "CRITICAL",
                "pattern": "COMBINED_RED_FLAG",
                "message": "Flow decreasing + Turbidity increasing simultaneously — "
                           "strong biofilm formation indicator"
            })

        # --- Combined: Flow↓ + TDS↑ (hard water + biofilm synergy) ---
        tds_rising = (first[self.IDX_TDS] > 0 and
                      ((last[self.IDX_TDS] - first[self.IDX_TDS])
                       / first[self.IDX_TDS]) * 100 > 10)
        if flow_dropping and tds_rising:
            alerts.append({
                "level": "CRITICAL",
                "pattern": "SCALE_BIOFILM_SYNERGY",
                "message": "Flow decreasing + TDS increasing — "
                           "hard water scaling + biofilm synergy risk"
            })

        return alerts

    @staticmethod
    def print_alerts(alerts):
        """Print trend alerts to console."""
        if not alerts:
            return
        print(f"  ┌─ TREND ANALYSIS ({len(alerts)} alert{'s' if len(alerts) > 1 else ''}) ─┐")
        for a in alerts:
            icon = {"CRITICAL": "🔴", "WARNING": "⚠️", "ALERT": "⚡"}.get(a["level"], "ℹ️")
            print(f"  │ {icon} [{a['level']}] {a['pattern']}: {a['message']}")
        print(f"  └{'─' * 50}┘")


# =============================================================================
# CHEMICAL DOSAGE CALCULATOR
# =============================================================================
def calculate_dosage(sensor_data, risk_percent, water_volume_l=1000):
    """Calculate recommended chemical dosages based on current sensor readings.

    Returns a list of recommendation dicts:
      {chemical, dosage, unit, reason}
    """
    recommendations = []
    vol_factor = water_volume_l / 1000.0

    ph = sensor_data.get("ph", 7.0)
    turb = sensor_data.get("turbidity", 0)

    # --- Chlorine / Disinfection ---
    if risk_percent >= 60:
        # Shock chlorination: calcium hypochlorite 8g/1000L (~50 ppm)
        dose = round(8 * vol_factor, 1)
        recommendations.append({
            "chemical": "Calcium Hypochlorite (65-70%)",
            "dosage": dose,
            "unit": "g",
            "reason": f"Shock chlorination — risk {risk_percent:.1f}% (≥60%)"
        })
    elif risk_percent >= 30:
        # Preventive: sodium hypochlorite 10ml/1000L
        dose = round(10 * vol_factor, 1)
        recommendations.append({
            "chemical": "Sodium Hypochlorite (12.5%)",
            "dosage": dose,
            "unit": "ml",
            "reason": f"Preventive disinfection — risk {risk_percent:.1f}%"
        })

    # --- pH Adjustment ---
    if ph < 6.5:
        # Soda ash: 170g per 0.1 pH-point raise per 1000L
        ph_delta = 6.5 - ph
        dose = round(ph_delta * 170 * vol_factor, 0)
        recommendations.append({
            "chemical": "Soda Ash (Sodium Carbonate)",
            "dosage": int(dose),
            "unit": "g",
            "reason": f"pH too low ({ph:.2f}) — raise to 6.5"
        })
    elif ph > 8.5:
        # Sodium bisulfate: 250g per 0.1 pH-point drop per 1000L
        ph_delta = ph - 8.5
        dose = round(ph_delta * 250 * vol_factor, 0)
        recommendations.append({
            "chemical": "Sodium Bisulfate",
            "dosage": int(dose),
            "unit": "g",
            "reason": f"pH too high ({ph:.2f}) — lower to 8.5"
        })

    # --- Turbidity (Alum) ---
    if turb > 5:
        # Aluminum sulfate: 30g/1000L for moderate turbidity
        dose = round(30 * vol_factor, 0)
        recommendations.append({
            "chemical": "Aluminum Sulfate (Alum)",
            "dosage": int(dose),
            "unit": "g",
            "reason": f"High turbidity ({turb:.1f} NTU > 5 NTU)"
        })

    return recommendations


def print_dosage(recommendations):
    """Print chemical dosage recommendations to console."""
    if not recommendations:
        print("  [DOSAGE] ✅ No chemical treatment required.")
        return
    print(f"  ┌─ CHEMICAL DOSAGE ({WATER_VOLUME_LITERS}L system) ─┐")
    for r in recommendations:
        print(f"  │ 💊 {r['chemical']}: {r['dosage']} {r['unit']} — {r['reason']}")
    print(f"  └{'─' * 50}┘")


# =============================================================================
# SENSOR DATA
# =============================================================================
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

# Instantiate the trend analyzer
trend_analyzer = TrendAnalyzer(min_window=3)


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
print(f"[INFO] Water system volume: {WATER_VOLUME_LITERS} L (set WATER_VOLUME_LITERS env to change)")
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

        # --- Trend Analysis (runs as soon as we have 3+ readings) ---
        trend_alerts = trend_analyzer.analyze(history_buffer)
        TrendAnalyzer.print_alerts(trend_alerts)

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

        # --- Escalate status if critical trend alerts detected ---
        critical_trends = [a for a in trend_alerts if a["level"] == "CRITICAL"]
        if critical_trends and status_code < 2:
            status_code = 2  # Bump to WARNING if trend analysis detects critical patterns

        # --- Encode Simulation Mode ---
        if SIMULATION_MODE:
            status_code = -abs(status_code) if status_code != 0 else -1

        # --- Chemical Dosage Recommendations ---
        dosage_recs = calculate_dosage(raw_data, risk, WATER_VOLUME_LITERS)
        print_dosage(dosage_recs)

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
