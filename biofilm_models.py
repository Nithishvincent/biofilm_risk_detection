import os

# Configure TensorFlow logging/CPU backend before importing tensorflow.
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
os.environ.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")

import numpy as np
import joblib
import tensorflow as tf
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, Dense, Dropout
from sklearn.ensemble import RandomForestRegressor
import xgboost as xgb

tf.get_logger().setLevel("ERROR")

class HybridBiofilmPredictor:
    def __init__(self):
        self.rf_model = RandomForestRegressor(n_estimators=100, max_depth=10, random_state=42)
        self.xgb_model = xgb.XGBRegressor(n_estimators=100, max_depth=6, learning_rate=0.1, random_state=42)
        self.lstm_model = None
        self.is_trained = False
        
    def build_lstm(self, input_shape):
        model = Sequential([
            LSTM(64, return_sequences=True, input_shape=input_shape),
            Dropout(0.2),
            LSTM(32),
            Dropout(0.2),
            Dense(16, activation='relu'),
            Dense(1, activation='linear')
        ])
        model.compile(optimizer='adam', loss='mse', metrics=['mae'])
        self.lstm_model = model
        
    def fit(self, X_seq, y):
        # X_seq shape: (samples, time_steps, features)
        # Prepare data for Tree models (Flatten: samples, time_steps*features)
        samples, steps, feats = X_seq.shape
        X_flat = X_seq.reshape(samples, steps * feats)
        
        print("Training Random Forest...")
        self.rf_model.fit(X_flat, y)
        
        print("Training XGBoost...")
        self.xgb_model.fit(X_flat, y)
        
        print("Training LSTM...")
        if self.lstm_model is None:
            self.build_lstm((steps, feats))
        
        # Train LSTM with early stopping logic if needed, but for simplicity here standard fit
        self.lstm_model.fit(X_seq, y, epochs=50, batch_size=32, verbose=0)
        
        self.is_trained = True
        print("Hybrid Training Complete.")
        
    def predict(self, X_seq):
        if not self.is_trained:
            raise Exception("Model not trained yet.")
            
        samples, steps, feats = X_seq.shape
        X_flat = X_seq.reshape(samples, steps * feats)
        
        # Get individual predictions
        pred_rf = self.rf_model.predict(X_flat)
        pred_xgb = self.xgb_model.predict(X_flat)
        
        # LSTM predict returns (samples, 1), flatten to (samples,)
        pred_lstm = self.lstm_model.predict(X_seq, verbose=0).flatten()
        
        # Ensemble Average
        # You could also learn weights, but simple average is robust
        final_pred = (pred_rf + pred_xgb + pred_lstm) / 3.0
        
        return final_pred, (pred_rf, pred_xgb, pred_lstm)

    def save(self, filepath):
        # Save Scikit-Learn/XGBoost models using joblib
        joblib.dump(self.rf_model, f"{filepath}_rf.pkl")
        joblib.dump(self.xgb_model, f"{filepath}_xgb.pkl")
        
        # Save Keras model
        if self.lstm_model:
            self.lstm_model.save(f"{filepath}_lstm.keras")

    def load(self, filepath):
        self.rf_model = joblib.load(f"{filepath}_rf.pkl")
        self.xgb_model = joblib.load(f"{filepath}_xgb.pkl")
        self.lstm_model = tf.keras.models.load_model(f"{filepath}_lstm.keras")
        self.is_trained = True
