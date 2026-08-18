const { Router } = require('express');
const { body } = require('express-validator');
const {
  sendOtp, verifyOtp, register, login, refresh, forgotAdminPassword, resetAdminPassword, resetCitizenPassword,
  changePassword, requestPasswordReset, confirmPasswordReset,
} = require('./auth.controller');
const { verifyToken } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { otpLimiter, otpVerifyLimiter, loginLimiter, passwordResetLimiter, universalPasswordResetLimiter } = require('../../middleware/rateLimiters');

const router = Router();

router.post('/send-otp',
  otpLimiter,
  body('mobile').isMobilePhone('en-IN').withMessage('Valid Indian mobile number required'),
  validate,
  sendOtp
);
router.post('/verify-otp', otpVerifyLimiter, verifyOtp);
router.post('/register',
  body('email').optional({ checkFalsy: true }).isEmail().withMessage('Enter a valid email address'),
  body('pincode').trim().matches(/^\d{6}$/).withMessage('Pincode must be a 6-digit number'),
  body('aadharNumber').optional({ checkFalsy: true }).matches(/^\d{12}$/).withMessage('Aadhaar number must be exactly 12 digits'),
  body('voterIdNumber').optional({ checkFalsy: true }).matches(/^[A-Za-z]{3}[0-9]{7}$/).withMessage('Enter a valid Voter ID (EPIC) number'),
  validate,
  register
);
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
