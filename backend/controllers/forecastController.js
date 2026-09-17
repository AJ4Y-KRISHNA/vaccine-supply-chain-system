const { getForecast } = require("../services/aiService");

exports.getForecast = async (req, res) => {

 try {

const response = await getForecast({
    vaccination_data: req.body?.vaccination_data,
    source_csv: req.body?.source_csv,
    months: req.body?.months || 12
});

  res.json({
   message: "Advisory demand baseline generated; inspect provenance and backtest limits",
   forecast: response
  });

 } catch (error) {

  console.error(error);

  res.status(500).json({
   error: "AI forecast service unavailable"
  });

 }

};
