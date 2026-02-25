import pandas as pd
import numpy as np
import random

# ===============================
# CONFIG
# ===============================
NEW_ROWS = 1200  # Total new rows to generate
OUTPUT_FILE = "dataset.csv"

# ===============================
# DATA GENERATION LOGIC
# ===============================
def generate_row():
    # Scenario distribution:
    # 0: High Biofilm Risk — optimal CONDITIONS for biofilm (neutral pH, warm, stagnant) — 40%
    # 1: Low Biofilm Risk  — harsh/inhibiting conditions (extreme pH, high flow, cold)    — 40%
    # 2: Medium Biofilm Risk — mixed/transitional conditions                              — 15%
    # 3: Edge Cases — simulated sensor faults / noise / out-of-range values               — 5%
    scenario = random.choices([0, 1, 2, 3], weights=[40, 40, 15, 5])[0]

    # --- SCENARIO 0: HIGH RISK ---
    if scenario == 0:
        ph = random.uniform(6.5, 7.8)          # Neutral pH ideal for bacteria
        temp = random.uniform(25.0, 35.0)      # Warm temp
        humidity = random.uniform(60.0, 90.0)  # High humidity
        flow = random.uniform(0.0, 15.0)       # Stagnant/Low flow
        turbidity = random.uniform(1000, 3000) # Dirty water
        tds = random.uniform(500, 1500)        # High TDS

    # --- SCENARIO 1: LOW RISK ---
    elif scenario == 1:
        # Explicit defaults first, then override per sub-type
        temp = random.uniform(20.0, 30.0)
        humidity = random.uniform(30.0, 60.0)
        turbidity = random.uniform(0.0, 200.0)  # Clear water
        tds = random.uniform(50.0, 300.0)

        sub_type = random.choice(['acidic', 'alkaline', 'high_flow', 'cold'])

        if sub_type == 'acidic':
            ph = random.uniform(3.0, 5.0)
            flow = random.uniform(20.0, 50.0)
        elif sub_type == 'alkaline':
            ph = random.uniform(9.0, 12.0)
            flow = random.uniform(20.0, 50.0)
        elif sub_type == 'high_flow':
            ph = random.uniform(6.0, 8.0)
            flow = random.uniform(60.0, 100.0)  # Flushing effect
        else:  # cold
            ph = random.uniform(6.0, 8.0)
            temp = random.uniform(5.0, 15.0)    # Override temp only
            flow = random.uniform(10.0, 40.0)

    # --- SCENARIO 2: MEDIUM RISK ---
    elif scenario == 2:
        ph = random.uniform(5.5, 8.5)
        temp = random.uniform(20.0, 30.0)
        humidity = random.uniform(40.0, 70.0)
        flow = random.uniform(15.0, 45.0)
        turbidity = random.uniform(200, 1000)
        tds = random.uniform(300, 800)

    # --- SCENARIO 3: EDGE CASES (Sensor Faults) ---
    else:
        ph = random.choice([0.0, 14.0, -1.0]) if random.random() < 0.5 else random.uniform(6, 8)
        temp = random.choice([0.0, 100.0]) if random.random() < 0.5 else random.uniform(25, 30)
        humidity = 0.0
        flow = 0.0
        turbidity = 0.0
        tds = 0.0

    # Ensure constraints (physically impossible values clamped generally, but kept for edge cases if intended)
    if scenario != 3:
        ph = max(0, min(14, ph))
        humidity = max(0, min(100, humidity))
        flow = max(0, flow)
        turbidity = max(0, turbidity)
        tds = max(0, tds)

    # ===============================
    # GROUND TRUTH LOGIC (Risk Calculation)
    # ===============================
    # We calculate a 'synthetic' risk score to label this data accurately.
    # Weights based on typical biofilm factors:
    # Flow: Negative correlation (High flow -> Low risk)
    # Turbidity: Positive correlation
    # pH: Bell curve (Optimal around 7)
    # Temp: Bell curve (Optimal ~30-35)
    
    # 1. Flow Score (0-100) -> 0 flow = 100 risk
    risk_flow = max(0, 100 - flow) 
    
    # 2. Turbidity Score (Scales log-ish)
    risk_turb = min(100, (turbidity / 2000) * 100)
    
    # 3. pH Score (Gaussian-like around 7)
    # Distance from 7.0. If |pH-7| > 3, risk is low.
    dist_ph = abs(ph - 7.0)
    risk_ph = max(0, 100 - (dist_ph * 30))
    
    # 4. Temp Score (Optimal 30)
    dist_temp = abs(temp - 30.0)
    risk_temp = max(0, 100 - (dist_temp * 5))

    # Weighted Sum
    # Flow and Turbidity are usually strong physical indicators
    # pH and Temp are biological enablers
    final_risk = (
        (risk_flow * 0.35) + 
        (risk_turb * 0.25) + 
        (risk_ph * 0.25) + 
        (risk_temp * 0.15)
    )
    
    # Add some random noise +/- 5%
    final_risk += random.uniform(-5, 5)
    final_risk = max(0, min(100, final_risk))

    # Determine Label
    if final_risk < 30:
        label = "LOW"
    elif final_risk < 60:
        label = "MEDIUM"
    else:
        label = "HIGH"

    return {
        "ph": ph,
        "temperature": temp,
        "humidity": humidity,
        "flow": flow,
        "turbidity": turbidity,
        "tds": tds,
        "biofilm_risk_percent": final_risk,
        "biofilm_formation_label": label
    }

# ===============================
# MAIN EXECUTION
# ===============================
print(f"Generating {NEW_ROWS} synthetic rows...")
new_data = [generate_row() for _ in range(NEW_ROWS)]
df_new = pd.DataFrame(new_data)

# Read existing
try:
    df_old = pd.read_csv(OUTPUT_FILE)
    df_combined = pd.concat([df_old, df_new], ignore_index=True)
    print(f"Appended to existing dataset. New total rows: {len(df_combined)}")
except FileNotFoundError:
    df_combined = df_new
    print(f"Created new dataset with {len(df_combined)} rows.")

# Save
df_combined.to_csv(OUTPUT_FILE, index=False)
print("Dataset updated successfully.")
