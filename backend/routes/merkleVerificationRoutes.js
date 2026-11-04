const router = require("express").Router();
const { requireIdentity } = require("../middleware/coldChainAccess");
const { scopeData, batchRead } = require("../middleware/identityScope");
const controller = require("../controllers/merkleVerificationController");
router.use(requireIdentity, scopeData);
router.get("/:batchId", batchRead, controller.verifyBatch);
router.get("/:batchId/reading/:id", batchRead, controller.verifyReading);
module.exports = router;
