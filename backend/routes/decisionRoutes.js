const express = require("express");
const router = express.Router();
const aiService = require("../services/aiService");
router.use(require("../middleware/auth").authenticate, require("../middleware/auth").allowRoles());

router.post("/distribution-decision", async (req, res) => {

    try {

        const result = await aiService.getDistributionDecision(req.body);

        res.json(result);

    } catch (error) {

        res.status(500).json({ error: error.message });

    }

});

module.exports = router;
