const express = require("express");

const router = express.Router();

const shipmentController = require("../controllers/shipmentController");
const { authenticate } = require("../middleware/auth");
const { requireIdentity, protectOperation } = require("../middleware/coldChainAccess");
router.use(requireIdentity, require("../middleware/auth").allowRoles("manufacturer", "distributor", "healthcare"), require("../middleware/identityScope").scopeData);

router.post("/create", requireIdentity, protectOperation(["admin", "distributor"], shipmentController.createShipment, { createsShipment: true }));
router.post("/:id/events", requireIdentity, require("../middleware/auth").allowRoles("distributor", "healthcare"), require("../controllers/shipmentEventController").createShipmentEvent);

router.get("/all", authenticate, shipmentController.getShipments);

module.exports = router;
