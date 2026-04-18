import numpy as np

class DecisionEngine:

    def calculate_distribution(self, sentiment_score, forecast_demand, historical_supply):

        """
        Smart Vaccine Distribution Logic

        sentiment_score
        positive sentiment → increase supply
        negative sentiment → reduce supply

        forecast_demand
        predicted vaccine demand

        historical_supply
        past vaccine supply data
        """

        avg_supply = np.mean(historical_supply)

        # sentiment adjustment
        sentiment_factor = 1

        if sentiment_score > 0.6:
            sentiment_factor = 1.2

        elif sentiment_score < 0.3:
            sentiment_factor = 0.8

        # final distribution decision
        recommended_supply = forecast_demand * sentiment_factor

        # safety cap
        if recommended_supply > avg_supply * 1.5:
            recommended_supply = avg_supply * 1.5

        return {
            "forecast_demand": forecast_demand,
            "sentiment_score": sentiment_score,
            "historical_average": avg_supply,
            "recommended_distribution": int(recommended_supply)
        }