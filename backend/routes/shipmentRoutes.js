const express = require("express");

const router = express.Router();

const shipmentController = require("../controllers/shipmentController");
const { authenticate } = require("../middleware/auth");

router.post("/create", authenticate, shipmentController.createShipment);

router.get("/all", authenticate, shipmentController.getShipments);

module.exports = router;
