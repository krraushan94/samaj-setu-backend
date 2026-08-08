const { Router } = require('express');
const { body } = require('express-validator');
const {
  sendOtp, verifyOtp, register, login, refresh, forgotAdminPassword, resetAdminPassword, resetCitizenPassword,
  changePassword, requestPasswordReset, confirmPasswordReset,
} = require('./auth.controller');
const { verifyToken } = require('../../middleware/auth');
const { otpLimiter, loginLimiter, passwordResetLimiter, universalPasswordResetLimiter } = require('../../middleware/rateLimiters');

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

// Universal self-service password flow — any role (citizen, leader, member, admin).
router.post('/change-password',        verifyToken, changePassword);
router.post('/forgot-password',        universalPasswordResetLimiter, requestPasswordReset);
router.post('/reset-password',         universalPasswordResetLimiter, confirmPasswordReset);

module.exports = router;
