const router = require("express").Router();
const { requireIdentity, protectOperation } = require("../middleware/coldChainAccess");
const { updateInventory } = require("../controllers/vaccinationController");
router.put("/", requireIdentity, protectOperation(["healthcare", "admin"], updateInventory));
module.exports = router;
