const router = require("express").Router();
const { authenticate } = require("../middleware/auth");
const { scopeData, batchRead } = require("../middleware/identityScope");
const { listBatchLocationHistory } = require("../controllers/locationHistoryController");

router.use(authenticate, scopeData);
router.get("/:batchId", batchRead, listBatchLocationHistory);

module.exports = router;
