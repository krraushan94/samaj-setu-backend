const { Router } = require('express');
const { verifyToken, requireTeamLeader, requireCitizen } = require('../../middleware/auth');
const { initiatePayment, confirmPayment, listPayments } = require('./payment.controller');

const router = Router();

router.post('/initiate',      verifyToken, requireCitizen, initiatePayment);
router.post('/:id/confirm',   verifyToken, requireTeamLeader, confirmPayment);
router.get('/',               verifyToken, requireTeamLeader, listPayments);

module.exports = router;
