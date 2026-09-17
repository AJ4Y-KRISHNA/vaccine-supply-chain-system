const express = require("express");

const router = express.Router();

const shipmentController = require("../controllers/shipmentController");
const { authenticate } = require("../middleware/auth");
const { requireIdentity, protectOperation } = require("../middleware/coldChainAccess");
router.use(requireIdentity, require("../middleware/auth").allowRoles("manufacturer", "distributor", "healthcare"), require("../middleware/identityScope").scopeData);

router.post("/create", requireIdentity, protectOperation(["admin", "distributor"], shipmentController.createShipment));

router.get("/all", authenticate, shipmentController.getShipments);

module.exports = router;
