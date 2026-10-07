const router = require("express").Router();
const { authenticate } = require("../middleware/auth");
const { scopeData } = require("../middleware/identityScope");
const controller = require("../controllers/traceabilityController");
router.use(authenticate, scopeData);
router.get("/batches", controller.listBatches);
router.get("/batches/:batchId", controller.getJourney);
module.exports = router;
