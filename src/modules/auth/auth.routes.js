'use strict';
const router = require('express').Router();
const validate = require('../../middlewares/validate');
const authenticate = require('../../middlewares/authenticate');
const { authLimiter } = require('../../middlewares/rateLimiter');
const v = require('./auth.validation');
const c = require('./auth.controller');

router.use(authLimiter);

router.post('/register', validate({ body: v.register }), c.register);
router.post('/verify-otp', validate({ body: v.verifyOtp }), c.verifyOtp);
router.post('/resend-otp', validate({ body: v.resendOtp }), c.resendOtp);
router.post('/login', validate({ body: v.login }), c.login);
router.post('/refresh', validate({ body: v.refresh }), c.refresh);
router.post('/logout', validate({ body: v.logout }), c.logout);
router.post('/forgot-password', validate({ body: v.forgotPassword }), c.forgotPassword);
router.post('/reset-password', validate({ body: v.resetPassword }), c.resetPassword);

router.post('/change-password', authenticate({ allowPasswordChange: true }), validate({ body: v.changePassword }), c.changePassword);
router.get('/me', authenticate({ allowPasswordChange: true }), c.me);

module.exports = router;
