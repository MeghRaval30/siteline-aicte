const express = require('express');
const { z } = require('zod');
const { rateLimit } = require('express-rate-limit');
const authController = require('./auth.controller');
const authenticate = require('../../shared/authenticate');

const router = express.Router();

const signupSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const validate = (schema) => (req, res, next) => {
  try {
    req.body = schema.parse(req.body);
    next();
  } catch (error) {
    return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', details: error.errors });
  }
};

// A strong password: 10+ characters with a letter and a digit.
const strongPassword = z.string().min(10, 'Use at least 10 characters').regex(/[A-Za-z]/, 'Include a letter').regex(/\d/, 'Include a digit');
const changePasswordSchema = z.object({ current_password: z.string().min(1), new_password: strongPassword });

// Per-IP throttle on sign-in; the controller adds a per-account lockout on top.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LOGIN_RATE_LIMIT) || (process.env.NODE_ENV === 'production' ? 20 : 300),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: 'TOO_MANY_ATTEMPTS' },
});

router.post('/signup', loginLimiter, validate(signupSchema), authController.signup);
router.post('/login', loginLimiter, validate(loginSchema), authController.login);
router.post('/change-password', authenticate, validate(changePasswordSchema), authController.changePassword);
router.get('/me', authenticate, authController.getMe);

module.exports = router;
