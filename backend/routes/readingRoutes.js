const express = require("express");
const router = express.Router();
const { authenticate, allowRoles } = require("../middleware/auth");
const controller = require("../controllers/manualReadingController");

router.use(authenticate);
router.post("/manual", allowRoles("admin", "distributor", "field_operator"), controller.createManualReading);
router.post("/import", allowRoles("admin", "healthcare"), express.raw({ type: ["text/csv", "application/csv", "multipart/form-data"], limit: "8mb" }), controller.importReadings);
router.post("/:id/correct", allowRoles("admin", "distributor", "field_operator"), controller.correctReading);

module.exports = router;
