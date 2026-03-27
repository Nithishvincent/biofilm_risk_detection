import pandas as pd
import numpy as np
import random

# ===============================
# CONFIG
# ===============================
HOURS = 24 * 30  # 30 days of hourly data in minutes (approx)
# Let's generate data points every 5 minutes -> 12 per hour
TIME_STEPS = HOURS * 12 
OUTPUT_FILE = "dataset_timeseries.csv"

# ===============================
# HELPER FUNCTIONS (Drift & Trend)
# ===============================
def clamp(val, min_val, max_val):
    return max(min_val, min(val, max_val))

def calculate_risk(ph, temp, flow, turb, tds):
    # Same logic as generate_data.py but tuned for time series
    risk_flow = max(0, 100 - flow)
    risk_turb = min(100, (turb / 2000) * 100)
    dist_ph = abs(ph - 7.0)
    risk_ph = max(0, 100 - (dist_ph * 30))
    dist_temp = abs(temp - 30.0)
    risk_temp = max(0, 100 - (dist_temp * 5))
    risk_tds = min(100, (tds / 1000) * 100)

    final_risk = (
        (risk_flow * 0.30) + 
        (risk_turb * 0.22) + 
        (risk_ph * 0.22) + 
        (risk_temp * 0.14) +
        (risk_tds * 0.12)
    )
    return final_risk

# ===============================
# GENERATION LOOP
# ===============================
data = []

# Initial States
current_ph = 7.0
current_temp = 25.0
current_humidity = 60.0
current_flow = 50.0
current_turbidity = 500.0
current_tds = 400.0

print(f"Generating {TIME_STEPS} time-series steps...")

for t in range(TIME_STEPS):
    # 1. Random Walk (Drift)
    # Values tend to stay similar to previous step but drift
    current_ph += random.uniform(-0.05, 0.05)
    current_temp += random.uniform(-0.5, 0.5)
    current_humidity += random.uniform(-1.0, 1.0)
    
    # Flow might have sudden changes (pump on/off)
    if random.random() < 0.01: # 1% chance of huge flow change
        current_flow = random.uniform(0, 100)
    else:
        current_flow += random.uniform(-2.0, 2.0)

    # Turbidity spikes
    if random.random() < 0.05: # 5% chance of spike
        current_turbidity += random.uniform(100, 500)
    else:
        current_turbidity += random.uniform(-50, 50) # settling

    # TDS follows turbidity somewhat
    current_tds = (current_turbidity * 0.4) + random.uniform(-50, 50)

    # Clamping
    current_ph = clamp(current_ph, 4.0, 10.0) # Keep within realistic bounds for water system
    current_temp = clamp(current_temp, 15.0, 45.0)
    current_humidity = clamp(current_humidity, 20.0, 100.0)
    current_flow = clamp(current_flow, 0.0, 100.0)
    current_turbidity = clamp(current_turbidity, 0.0, 3000.0)
    current_tds = clamp(current_tds, 0.0, 1500.0)

    # Calc Risk
    risk = calculate_risk(current_ph, current_temp, current_flow, current_turbidity, current_tds)
    
    # Label
    if risk < 30: label = "LOW"
    elif risk < 60: label = "MEDIUM"
    else: label = "HIGH"

    data.append({
        "ph": round(current_ph, 2),
        "temperature": round(current_temp, 2),
        "humidity": round(current_humidity, 2),
        "flow": round(current_flow, 2),
        "turbidity": round(current_turbidity, 2),
        "tds": round(current_tds, 2),
        "biofilm_risk_percent": round(risk, 2),
        "biofilm_formation_label": label
    })

df = pd.DataFrame(data)
df.to_csv(OUTPUT_FILE, index=False)
print(f"Saved to {OUTPUT_FILE}")
