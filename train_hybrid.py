import pandas as pd
import numpy as np
import joblib
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score
from biofilm_models import HybridBiofilmPredictor
import os

# ===============================
# CONFIGURATION
# ===============================
DATA_PATH = "dataset_timeseries.csv"
MODEL_PATH = "biofilm_hybrid_model"
SEQ_LENGTH = 10
FEATURES = ['ph', 'temperature', 'humidity', 'flow', 'turbidity', 'tds']

# ===============================
# LOAD & PROCESS DATA
# ===============================
print("Loading Time-Series Dataset...")
if not os.path.exists(DATA_PATH):
    print("Error: dataset_timeseries.csv not found.")
    exit(1)

df = pd.read_csv(DATA_PATH)
target_col = 'biofilm_risk_percent'

# Features to use
feature_cols = ['ph', 'temperature', 'humidity', 'flow', 'turbidity', 'tds']
data = df[feature_cols].values
target = df[target_col].values

# Scale Features (Crucial for LSTM)
from sklearn.preprocessing import MinMaxScaler
scaler = MinMaxScaler(feature_range=(0, 1))
data_scaled = scaler.fit_transform(data)

# Save scaler for inference later
joblib.dump(scaler, "scaler_hybrid.pkl")

# Create Sliding Windows
X_seq = []
y_seq = []

print(f"Creating sequences of length {SEQ_LENGTH}...")
for i in range(SEQ_LENGTH, len(data_scaled)):
    # Input: Window of past 10 steps (t-10 to t-1)
    # Output: Correlation to current risk (at t)
    # Or predictive: (t-9 to t) -> (t+1)?
    # Let's align with test.py which likely uses past 10 to predict CURRENT state risk
    X_seq.append(data_scaled[i-SEQ_LENGTH:i]) 
    y_seq.append(target[i])

X_seq = np.array(X_seq)
y_seq = np.array(y_seq)

print(f"Data Shape: {X_seq.shape}")

# Train/Test Split (Time Series Split - No Shuffle to prevent leakage)
# Using simple index split for time series
split_idx = int(len(X_seq) * 0.8)
X_train, X_test = X_seq[:split_idx], X_seq[split_idx:]
y_train, y_test = y_seq[:split_idx], y_seq[split_idx:]

print(f"Train samples: {len(X_train)}, Test samples: {len(X_test)}")


# ===============================
# TRAIN HYBRID MODEL
# ===============================
print("\nInitializing Hybrid Ensemble (RF + XGB + LSTM)...")
model = HybridBiofilmPredictor()

print("Starting Training...")
model.fit(X_train, y_train)

# ===============================
# EVALUATION
# ===============================
print("\nEvaluating on Test Set...")
y_pred, (p_rf, p_xgb, p_lstm) = model.predict(X_test)

r2_ensemble = r2_score(y_test, y_pred)
mae_ensemble = mean_absolute_error(y_test, y_pred)

print("-" * 40)
print(f"Hybrid Ensemble R²: {r2_ensemble:.4f}")
print(f"Hybrid Ensemble MAE: {mae_ensemble:.4f}")
print("-" * 40)
print(f"Individual R² Scores:")
print(f"  Random Forest: {r2_score(y_test, p_rf):.4f}")
print(f"  XGBoost:       {r2_score(y_test, p_xgb):.4f}")
print(f"  LSTM:          {r2_score(y_test, p_lstm):.4f}")
print("-" * 40)

# ===============================
# SAVE MODEL
# ===============================
print(f"Saving Hybrid Model to {MODEL_PATH}...")
model.save(MODEL_PATH)

# ===============================
# VISUALIZATION
# ===============================
import matplotlib.pyplot as plt
import seaborn as sns

print("Generating detailed evaluation plots...")

def plot_model_performance(y_true, y_pred, model_name, color, filename):
    # Ensure 1D arrays
    if not np.isscalar(y_pred[0]): y_pred = y_pred.flatten()
    
    r2 = r2_score(y_true, y_pred)
    mae = mean_absolute_error(y_true, y_pred)
    
    plt.figure(figsize=(14, 6))
    
    # 1. Actual vs Predicted
    plt.subplot(1, 2, 1)
    plt.scatter(y_true, y_pred, alpha=0.5, color=color, label='Prediction')
    plt.plot([0, 100], [0, 100], 'r--', lw=2, label='Ideal Fit')
    plt.xlabel('Actual Risk (%)')
    plt.ylabel('Predicted Risk (%)')
    plt.title(f'{model_name} - Actual vs Predicted\nR²: {r2:.4f}, MAE: {mae:.4f}')
    plt.legend()
    plt.grid(True, alpha=0.3)
    
    # 2. Residual Distribution
    plt.subplot(1, 2, 2)
    residuals = y_true - y_pred
    sns.histplot(residuals, bins=30, kde=True, color=color)
    plt.axvline(0, color='r', linestyle='--')
    plt.xlabel('Residual Error')
    plt.title(f'{model_name} - Residual Error Distribution')
    plt.grid(True, alpha=0.3)
    
    plt.tight_layout()
    plt.savefig(filename)
    print(f"Saved {filename}")
    plt.close()

# Generate Individual Plots
plot_model_performance(y_test, p_rf, "Random Forest", "green", "eval_random_forest.png")
plot_model_performance(y_test, p_xgb, "XGBoost", "orange", "eval_xgboost.png")
plot_model_performance(y_test, p_lstm, "LSTM", "purple", "eval_lstm.png")
plot_model_performance(y_test, y_pred, "Hybrid Ensemble", "blue", "eval_hybrid_ensemble.png")

# Summary Comparison Bar Chart
plt.figure(figsize=(10, 6))
models_list = ['Random Forest', 'XGBoost', 'LSTM', 'Hybrid Ensemble']
r2_list = [r2_score(y_test, p_rf), r2_score(y_test, p_xgb), r2_score(y_test, p_lstm), r2_ensemble]

sns.barplot(x=models_list, y=r2_list, palette='viridis', hue=models_list, legend=False)
plt.ylim(0, 1.1)
plt.ylabel('R² Score')
plt.title('Model Performance Comparison Summary')
for i, v in enumerate(r2_list):
    plt.text(i, v + 0.02, f"{v:.3f}", ha='center', fontweight='bold')

plt.tight_layout()
plt.savefig('eval_comparison_summary.png')
print("Saved eval_comparison_summary.png")

print("All evaluations complete.")
