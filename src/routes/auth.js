import express from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { generateToken, authRequired, loginRateLimiter } from '../auth.js';
import { changePassword, AppError } from '../services/users.js';

const router = express.Router();

const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';

router.post('/login', loginRateLimiter, (req, res, next) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return next(new AppError('VALIDATION_ERROR', 'Username and password are required.', 400));
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

    if (!user) {
      return next(new AppError('AUTH_INVALID_CREDENTIALS', 'Invalid username or password.', 401));
    }

    if (user.active !== 1) {
      return next(new AppError('AUTH_REQUIRED', 'This user account has been deactivated.', 401));
    }

    const passwordMatches = bcrypt.compareSync(password, user.password_hash);
    if (!passwordMatches) {
      return next(new AppError('AUTH_INVALID_CREDENTIALS', 'Invalid username or password.', 401));
    }

    const token = generateToken(user);

    // Set cookie
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: COOKIE_SECURE,
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.json({
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        role: user.role,
        telegram_chat_id: user.telegram_chat_id,
        active: !!user.active,
        created_at: user.created_at
      }
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', authRequired, (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE
  });
  res.status(204).end();
});

router.get('/me', authRequired, (req, res) => {
  res.json({ user: req.user });
});

router.post('/change-password', authRequired, (req, res, next) => {
  const { currentPassword, newPassword } = req.body;
  
  if (!currentPassword || !newPassword) {
    return next(new AppError('VALIDATION_ERROR', 'Current password and new password are required.', 400));
  }

  try {
    const result = changePassword(req.user.id, currentPassword, newPassword);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
