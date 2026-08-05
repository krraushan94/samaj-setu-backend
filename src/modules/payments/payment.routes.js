const { Router } = require('express');
const { verifyToken, requirePaymentAccess, requireCitizen } = require('../../middleware/auth');
const { initiatePayment, confirmPayment, listPayments } = require('./payment.controller');

const router = Router();

router.post('/initiate',      verifyToken, requireCitizen, initiatePayment);
router.post('/:id/confirm',   verifyToken, requirePaymentAccess, confirmPayment);
router.get('/',               verifyToken, requirePaymentAccess, listPayments);

module.exports = router;
