import jwt from 'jsonwebtoken';
import db from './db.js';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-dev';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// In-memory login rate limiter mapping IP to attempt info
const loginRateLimitMap = new Map();

// Clean up old rate limit entries every minute to prevent memory leak
const rateLimitCleaner = setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of loginRateLimitMap.entries()) {
    if (now - data.firstAttemptTime > 60000) {
      loginRateLimitMap.delete(ip);
    }
  }
}, 60000);

if (typeof rateLimitCleaner.unref === 'function') {
  rateLimitCleaner.unref();
}

/**
 * Express middleware to enforce login rate limits (max 5 per min per IP)
 */
export function loginRateLimiter(req, res, next) {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const now = Date.now();

  let limitData = loginRateLimitMap.get(ip);
  if (!limitData || (now - limitData.firstAttemptTime > 60000)) {
    limitData = { count: 1, firstAttemptTime: now };
    loginRateLimitMap.set(ip, limitData);
    return next();
  }

  limitData.count++;
  if (limitData.count > 5) {
    return res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many login attempts. Please try again in a minute.'
      }
    });
  }

  next();
}

/**
 * Middleware to require authentication (validate JWT in cookie)
 */
export function authRequired(req, res, next) {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).json({
      error: {
        code: 'AUTH_REQUIRED',
        message: 'Authentication is required to access this resource.'
      }
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Retrieve user from DB and verify active status
    const user = db.prepare('SELECT id, name, username, role, active FROM users WHERE id = ?').get(decoded.id);

    if (!user) {
      return res.status(401).json({
        error: {
          code: 'AUTH_REQUIRED',
          message: 'User does not exist.'
        }
      });
    }

    if (user.active !== 1) {
      return res.status(401).json({
        error: {
          code: 'AUTH_REQUIRED',
          message: 'This user account has been deactivated.'
        }
      });
    }

    req.user = {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role
    };

    next();
  } catch (err) {
    return res.status(401).json({
      error: {
        code: 'AUTH_REQUIRED',
        message: 'Session has expired or token is invalid.'
      }
    });
  }
}

/**
 * Middleware to authorize specific roles
 * @param {string[]} roles
 */
export function roleRequired(roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: {
          code: 'AUTH_REQUIRED',
          message: 'Authentication is required.'
        }
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: `This action requires one of the following roles: ${roles.join(', ')}.`
        }
      });
    }

    next();
  };
}

/**
 * Admin only middleware shorthand
 */
export const adminOnly = roleRequired(['admin']);

/**
 * Generates JWT for a user
 * @param {object} user
 */
export function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}
