const { Router } = require('express');
const { body } = require('express-validator');
const { sendOtp, verifyOtp, register, login, refresh, forgotAdminPassword, resetAdminPassword, resetCitizenPassword } = require('./auth.controller');
const { otpLimiter, loginLimiter, passwordResetLimiter } = require('../../middleware/rateLimiters');

const router = Router();

router.post('/send-otp',
  otpLimiter,
  body('mobile').isMobilePhone('en-IN').withMessage('Valid Indian mobile number required'),
  sendOtp
);
router.post('/verify-otp', verifyOtp);
router.post('/register', register);
router.post('/login', loginLimiter, login);
router.post('/refresh', refresh);
router.post('/admin/forgot-password', passwordResetLimiter, forgotAdminPassword);
router.post('/admin/reset-password',  passwordResetLimiter, resetAdminPassword);
router.post('/citizen/reset-password', passwordResetLimiter, resetCitizenPassword);

module.exports = router;
