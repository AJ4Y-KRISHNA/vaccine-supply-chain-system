const express = require("express");

const router = express.Router();

const vaccinationController = require("../controllers/vaccinationController");
const { authenticate } = require("../middleware/auth");

router.post("/request", authenticate, vaccinationController.requestVaccines);
router.post("/inventory", authenticate, vaccinationController.updateInventory);
router.post("/administer", authenticate, vaccinationController.administerVaccines);
router.post("/report", authenticate, vaccinationController.recordAndReport);
router.post("/workflow", authenticate, vaccinationController.runVaccinationWorkflow);
router.get("/workflow", authenticate, vaccinationController.getWorkflowStatus);

router.post("/create", authenticate, vaccinationController.createRecord);

router.get("/all", authenticate, vaccinationController.getRecords);

module.exports = router;
