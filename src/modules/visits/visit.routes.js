const { Router } = require('express');
const { verifyToken, requireAdmin, requireCitizen } = require('../../middleware/auth');
const { createVisit, myVisits, cancelVisit, listVisits, scheduleVisit } = require('./visit.controller');

const router = Router();

router.post('/',              verifyToken, requireCitizen, createVisit);
router.get('/my',              verifyToken, requireCitizen, myVisits);
router.patch('/:id/cancel',    verifyToken, requireCitizen, cancelVisit);
router.get('/',                verifyToken, requireAdmin,   listVisits);
router.patch('/:id/schedule',  verifyToken, requireAdmin,   scheduleVisit);

module.exports = router;
