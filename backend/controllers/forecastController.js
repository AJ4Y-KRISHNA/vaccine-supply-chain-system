const axios = require("axios");

exports.getForecast = async (req, res) => {

 try {

const response = await axios.post("http://127.0.0.1:8000/forecast/forecast", {
    vaccination_data: req.body?.vaccination_data,
    source_csv: req.body?.source_csv,
    months: req.body?.months || 12
});

  res.json({
   message: "AI demand forecast generated",
   forecast: response.data
  });

 } catch (error) {

  console.error(error);

  res.status(500).json({
   error: "AI forecast service unavailable"
  });

 }

};
