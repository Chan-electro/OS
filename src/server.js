import express from 'express';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import clientRoutes from './routes/clients.js';
import projectRoutes from './routes/projects.js';
import taskRoutes from './routes/tasks.js';
import dashboardRoutes from './routes/dashboard.js';
import lifeRoutes from './routes/life.js';
import contentRoutes from './routes/content.js';
import { initCrons } from './cron.js';
import { AppError } from './services/users.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cookieParser());

// Request logger middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
  });
  next();
});

// Static PWA files hosting
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/life', lifeRoutes);
app.use('/api/content', contentRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    uptime: process.uptime(),
    version: '1.0.0'
  });
});

// Catch-all API 404
app.use('/api/*', (req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Endpoint ${req.method} ${req.originalUrl} not found.`
    }
  });
});

// Serve frontend SPA index.html for any other client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Global Error Handler Middleware
app.use((err, req, res, next) => {
  console.error('[Error Occurred]', err);

  // 1. Handle our custom application errors
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {})
      }
    });
  }

  // 2. Handle database constraint errors from better-sqlite3
  if (err.code && err.code.startsWith('SQLITE_')) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'A resource with this value already exists.'
        }
      });
    }
    if (err.message.includes('FOREIGN KEY constraint failed')) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid referenced relation (foreign key constraint violated).'
        }
      });
    }
    if (err.message.includes('CHECK constraint failed')) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Data check constraint failed.'
        }
      });
    }
  }

  // 3. Fallback to generic 500 error
  res.status(500).json({
    error: {
      code: 'INTERNAL',
      message: 'An unexpected internal server error occurred.'
    }
  });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AdGrades OS server is running on http://0.0.0.0:${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
  });
  initCrons();
}

export default app;
