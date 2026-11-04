import numpy as np
import tensorflow as tf
import pandas as pd
from sklearn.preprocessing import MinMaxScaler
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import Conv1D, LSTM, Dense
from tensorflow.keras.layers import Flatten


class VaccineDemandForecast:

    def __init__(self):
        self.model = None
        self.scaler = MinMaxScaler()

    def prepare_data(self, data):

        data = np.array(data).reshape(-1, 1)

        scaled = self.scaler.fit_transform(data)

        X = []
        y = []

        window = 3

        for i in range(len(scaled) - window):
            X.append(scaled[i:i+window])
            y.append(scaled[i+window])

        X = np.array(X)
        y = np.array(y)

        return X, y

    def build_model(self, input_shape):

        model = Sequential()

        model.add(
            Conv1D(
                filters=64,
                kernel_size=2,
                activation="relu",
                input_shape=input_shape
            )
        )

        model.add(LSTM(50))

        model.add(Dense(1))

        model.compile(
            optimizer="adam",
            loss="mse"
        )

        self.model = model

    def train(self, vaccination_data):
        if len(vaccination_data) < 6:
            raise ValueError("At least six observations required for experimental training")
        tf.keras.utils.set_random_seed(42)
        tf.config.experimental.enable_op_determinism()
        X, y = self.prepare_data(vaccination_data)

        self.build_model((X.shape[1], 1))

        self.model.fit(
            X,
            y,
            epochs=10,
            shuffle=False,
            verbose=0
        )

    def predict(self, vaccination_data):
        if self.model is None or len(vaccination_data) < 3:
            raise ValueError("Train a model first and provide at least three observations")
        # Do not refit the training scaler or reuse the penultimate training window.
        latest = self.scaler.transform(np.asarray(vaccination_data[-3:]).reshape(-1, 1))
        prediction = self.model.predict(latest.reshape(1, 3, 1), verbose=0)

        result = self.scaler.inverse_transform(prediction)

        return max(0, int(np.ceil(result[0][0])))
