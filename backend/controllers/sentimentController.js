const axios = require("axios");

exports.analyzeSentiment = async (req, res) => {
  try {
    const response = await axios.post("http://127.0.0.1:8000/sentiment", {
      text: req.body.text
    });

    res.json(response.data);

  } catch (error) {
    res.status(500).json({ error: "Sentiment AI service unavailable" });
  }
};