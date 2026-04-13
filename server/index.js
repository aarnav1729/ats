import 'dotenv/config';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import fs from 'fs';
import https from 'https';
import path from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import express from 'express';
import cors from 'cors';
import { PG_CONFIG, pool } from './db.js';
import { ensureSchema } from './migrations/run.js';
import authRoutes from './routes/auth.js';
import publicRoutes from './routes/public.js';
import userRoutes from './routes/users.js';
import masterRoutes from './routes/masters.js';
import aopRoutes from './routes/aop.js';
import requisitionRoutes from './routes/requisitions.js';
import jobRoutes from './routes/jobs.js';
import applicationRoutes from './routes/applications.js';
import interviewRoutes from './routes/interviews.js';
import candidateRoutes from './routes/candidates.js';
import auditRoutes from './routes/audit.js';
import misRoutes from './routes/mis.js';
import notificationRoutes from './routes/notifications.js';
import demoRoutes from './routes/demo.js';
import orgRoutes from './routes/org.js';
import clearanceRoutes from './routes/clearance.js';
import { authMiddleware } from './middleware/auth.js';

const app = express();
const PORT = 51443;
const clientDir = path.resolve(__dirname, '../client');
const clientDistDir = path.resolve(clientDir, 'dist');
const clientIndexPath = path.resolve(clientDistDir, 'index.html');

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')));

// Public routes
app.use('/api/auth', authRoutes);
app.use('/api/public', publicRoutes);

// Protected routes
app.use('/api/users', authMiddleware, userRoutes);
app.use('/api/masters', authMiddleware, masterRoutes);
app.use('/api/aop', authMiddleware, aopRoutes);
app.use('/api/requisitions', authMiddleware, requisitionRoutes);
app.use('/api/jobs', authMiddleware, jobRoutes);
app.use('/api/applications', authMiddleware, applicationRoutes);
app.use('/api/interviews', authMiddleware, interviewRoutes);
app.use('/api/candidates', authMiddleware, candidateRoutes);
app.use('/api/audit', authMiddleware, auditRoutes);
app.use('/api/mis', authMiddleware, misRoutes);
app.use('/api/notifications', authMiddleware, notificationRoutes);
app.use('/api/demo', authMiddleware, demoRoutes);
app.use('/api/org', authMiddleware, orgRoutes);
app.use('/api/candidates', authMiddleware, clearanceRoutes);

// Health check
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (e) {
    res.status(500).json({ status: 'error', db: 'disconnected', error: e.message });
  }
});

app.use(express.static(clientDistDir));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
    return next();
  }
  if (!fs.existsSync(clientIndexPath)) {
    return res.status(503).send('Client build is not available yet.');
  }
  return res.sendFile(clientIndexPath);
});

function buildClient() {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(npmCommand, ['run', 'build'], {
      cwd: clientDir,
      stdio: 'inherit',
      env: process.env,
    });

    child.on('error', rejectPromise);
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`Client build failed with exit code ${code}`));
    });
  });
}

async function start() {
  await buildClient();
  await ensureSchema();
  const httpsOptions = {
    key: fs.readFileSync(path.join(__dirname, 'certs', 'mydomain.key')),
    cert: fs.readFileSync(
      path.join(__dirname, 'certs', 'd466aacf3db3f299.crt')
    ),
    ca: fs.readFileSync(path.join(__dirname, 'certs', 'gd_bundle-g2-g1.crt')),
  };

  https.createServer(httpsOptions, app).listen(PORT, () => {
    console.log(`🚀 HTTPS server running → https://localhost:${PORT}`);
    console.log(
      `🗄️ PostgreSQL → ${PG_CONFIG.host}:${PG_CONFIG.port}/${PG_CONFIG.database}`
    );
  });
}

start().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
