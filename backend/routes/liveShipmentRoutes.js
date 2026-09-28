const router = require("express").Router();
const { authenticate } = require("../middleware/auth");
const { scopeData } = require("../middleware/identityScope");
const controller = require("../controllers/liveShipmentController");

router.use(authenticate, scopeData);
router.get("/", controller.listLiveShipments);

module.exports = router;
