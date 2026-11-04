import os


class MultilingualSentiment:
    def __init__(self):
        self.classifier = None
        self.model_available = False
        # No model download during startup; opt in explicitly for the optional experiment.
        if os.getenv("ENABLE_EXPERIMENTAL_BERT") != "true":
            return
        try:
            from transformers import pipeline
            self.classifier = pipeline(
                "sentiment-analysis",
                model="nlptown/bert-base-multilingual-uncased-sentiment"
            )
            self.model_available = True
        except Exception:
            self.classifier = None
            self.model_available = False

    def _mock_analyze(self, text):
        normalized = str(text or "").strip().lower()
        positive_hints = [
            "effective",
            "smooth",
            "safe",
            "good",
            "stable",
            "successful",
            "helpful",
            "protected",
            "improved",
            "satisfied",
        ]
        negative_hints = [
            "side effect",
            "issue",
            "pain",
            "delay",
            "ineffective",
            "worry",
            "storage concern",
            "warm",
            "bad",
            "problem",
            "reaction",
            "unsafe",
            "complaint",
        ]

        score = 0.55
        for keyword in positive_hints:
            if keyword in normalized:
                score += 0.10
        for keyword in negative_hints:
            if keyword in normalized:
                score -= 0.12

        score = max(0.0, min(1.0, score))
        if score >= 0.7:
            sentiment = "Positive"
        elif score < 0.4:
            sentiment = "Negative"
        else:
            sentiment = "Neutral"

        return {
            "sentiment": sentiment,
            "confidence": score,
            "score": score,
            "scoring_status": "Mocked Fallback",
        }

    def analyze(self, text):
        normalized_text = str(text or "").strip()
        if not normalized_text:
            return {
                "sentiment": "Neutral",
                "confidence": 0.5,
                "score": 0.5,
                "scoring_status": "Mocked Fallback",
            }

        if self.classifier is not None:
            try:
                result = self.classifier(normalized_text)[0]
                return {
                    "sentiment": result["label"],
                    "confidence": result["score"],
                    "scoring_status": "AI Model",
                }
            except Exception:
                pass

        return self._mock_analyze(normalized_text)
