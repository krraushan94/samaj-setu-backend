const { Router } = require('express');
const { body } = require('express-validator');
const { sendOtp, verifyOtp, register, login, refresh } = require('./auth.controller');

const router = Router();

router.post('/send-otp',
  body('mobile').isMobilePhone('en-IN').withMessage('Valid Indian mobile number required'),
  sendOtp
);
router.post('/verify-otp', verifyOtp);
router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refresh);

module.exports = router;
