const express = require("express");

const router = express.Router();

const vaccinationController = require("../controllers/vaccinationController");
const { authenticate } = require("../middleware/auth");
const { requireIdentity, protectOperation } = require("../middleware/coldChainAccess");
router.use(requireIdentity, require("../middleware/auth").allowRoles("healthcare"), require("../middleware/identityScope").scopeData);

router.post("/request", authenticate, require("../middleware/identityScope").bindOrganization, vaccinationController.requestVaccines);
router.post("/inventory", requireIdentity, protectOperation(["admin", "healthcare"], vaccinationController.updateInventory));
router.post("/administer", requireIdentity, protectOperation(["admin", "healthcare"], vaccinationController.administerVaccines));
router.post("/report", requireIdentity, protectOperation(["admin", "healthcare"], vaccinationController.recordAndReport));
router.post("/workflow", requireIdentity, protectOperation(["admin", "healthcare"], vaccinationController.runVaccinationWorkflow));
router.get("/workflow", authenticate, vaccinationController.getWorkflowStatus);

router.post("/create", requireIdentity, protectOperation(["admin", "healthcare"], vaccinationController.createRecord));

router.get("/all", authenticate, vaccinationController.getRecords);

module.exports = router;
