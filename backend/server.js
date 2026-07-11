// Main server file - 로컬에서만 .env 로드 (서버 배포 시에는 Render 등에서 주입한 환경변수 사용)
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const config = require('./config');

// Import routes with error handling
let authRoutes, casesRoutes, defectsRoutes, defectCategoriesRoutes;
let inspectionsRoutes, inspectorRegistrationRoutes, pushNotificationRoutes;
let youtubeSearchRoutes, aiLearningRoutes, azureAIRoutes, aiDetectionRoutes;
let uploadRoutes, reportsRoutes, smsRoutes, adminRoutes;

try {
  authRoutes = require('./routes/auth');
  casesRoutes = require('./routes/cases');
  defectsRoutes = require('./routes/defects');
  defectCategoriesRoutes = require('./routes/defect-categories');
  inspectionsRoutes = require('./routes/inspections');
  inspectorRegistrationRoutes = require('./routes/inspector-registration');
  pushNotificationRoutes = require('./routes/push-notifications');
  youtubeSearchRoutes = require('./routes/youtube-search');
  aiLearningRoutes = require('./routes/ai-learning');
  azureAIRoutes = require('./routes/azure-ai');
  aiDetectionRoutes = require('./routes/ai-detection');
  uploadRoutes = require('./routes/upload');
  reportsRoutes = require('./routes/reports');
  smsRoutes = require('./routes/sms');
  adminRoutes = require('./routes/admin');
  console.log('✅ All routes loaded successfully');
} catch (error) {
  console.error('❌ Failed to load routes:', error);
  console.error('Error stack:', error.stack);
  process.exit(1);
}

const app = express();

// CORS configuration - must be before helmet
const corsOptions = {
  origin: (origin, callback) => {
    // 허용할 Origin 목록
    const allowedOrigins = [
      'http://localhost:3000', 
      'http://127.0.0.1:3000', 
      'http://localhost:8080', 
      'http://127.0.0.1:8080',
      'https://insighti.vercel.app',
      'https://*.vercel.app'
    ];
    
    // Vercel 도메인 체크
    const isVercelApp = origin && (
      origin.includes('.vercel.app') || 
      origin.includes('insighti.vercel.app')
    );
    
    // 개발 환경에서는 모든 origin 허용
    if (process.env.NODE_ENV !== 'production') {
      callback(null, true);
      return;
    }
    
    // Origin이 없거나 (같은 도메인 요청, Postman 등) 허용된 origin인 경우
    if (!origin || allowedOrigins.some(allowed => origin.includes(allowed.replace('*.', ''))) || isVercelApp) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['Content-Type', 'Authorization'],
  preflightContinue: false,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));

// OPTIONS 요청 명시적 처리 (CORS preflight) - 모든 경로에 대해
app.options('*', cors(corsOptions));

// HTTPS 강제 리다이렉트 (프로덕션 환경)
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    // X-Forwarded-Proto 헤더 확인 (Vercel, Render 등 프록시 환경)
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
  
  // HSTS 헤더 설정 (선택)
  app.use((req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
}

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Logging
app.use(morgan('combined'));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Static files (for uploaded images and reports)
// 업로드: UPLOAD_DIR 있으면 사용(Persistent Disk), 없으면 backend/uploads
const uploadDir = path.isAbsolute(config.upload.dir)
  ? config.upload.dir
  : path.join(__dirname, config.upload.dir);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(uploadDir));
app.use('/uploads/thumbs', express.static(path.join(uploadDir, 'thumbs')));
app.use('/reports', express.static(path.join(__dirname, 'reports')));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/cases', casesRoutes);
app.use('/api/defects', defectsRoutes);
app.use('/api/defect-categories', defectCategoriesRoutes);
app.use('/api/inspections', inspectionsRoutes); // NEW: Equipment inspections
app.use('/api/inspector-registration', inspectorRegistrationRoutes); // NEW: Inspector registration
app.use('/api/push', pushNotificationRoutes); // NEW: Push notifications
app.use('/api/youtube', youtubeSearchRoutes); // NEW: YouTube 실시간 검색
app.use('/api/ai-learning', aiLearningRoutes);
app.use('/api/azure-ai', azureAIRoutes); // NEW: Azure OpenAI
app.use('/api/ai-detection', aiDetectionRoutes); // NEW: Hybrid AI detection
app.use('/api/upload', uploadRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/sms', smsRoutes);
app.use('/api/admin', adminRoutes); // NEW: Admin functions

// Root endpoint (for Render health checks)
const APP_VERSION = '4.4.5';

app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'InsightI API Server is running',
    timestamp: new Date().toISOString(),
    version: APP_VERSION
  });
});

// Health check endpoint (?db=1 이면 DB 연결 상태 포함)
app.get('/health', async (req, res) => {
  const payload = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: APP_VERSION,
  };

  if (req.query.db === '1') {
    try {
      const pool = require('./database');
      await pool.query('SELECT 1 AS ok');
      payload.database = 'connected';
      const counts = await pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM complex) AS complexes,
          (SELECT COUNT(*)::int FROM household) AS households,
          (SELECT COUNT(*)::int FROM case_header) AS cases,
          (SELECT COUNT(*)::int FROM defect) AS defects
      `);
      payload.counts = counts.rows[0];
    } catch (error) {
      return res.status(503).json({
        ...payload,
        status: 'DEGRADED',
        database: 'disconnected',
        error: error.message,
      });
    }
  }

  res.json(payload);
});

// 점검 스키마 수동 보강 (헤더 x-restore-key = JWT_SECRET)
app.post('/health/bootstrap-schema', async (req, res) => {
  const key = req.headers['x-restore-key'];
  if (!key || key !== config.jwt.secret) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const pool = require('./database');
  const { ensureInspectionSchema } = require('./utils/ensureInspectionSchema');
  try {
    const result = await ensureInspectionSchema(pool);
    res.json({ ok: result.ok, inspection_item: result.inspection_item || null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 레퍼런스 데이터 수동 복구 (헤더 x-restore-key = JWT_SECRET)
app.post('/health/restore-reference', async (req, res) => {
  const key = req.headers['x-restore-key'];
  if (!key || key !== config.jwt.secret) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const pool = require('./database');
  const { restoreReferenceData, restoreSampleCasesAndDefects } = require('./utils/restoreReferenceData');
  const client = await pool.connect();
  try {
    const summary = await restoreReferenceData(client);
    await restoreSampleCasesAndDefects(client);
    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM complex) AS complexes,
        (SELECT COUNT(*)::int FROM household) AS households,
        (SELECT COUNT(*)::int FROM case_header) AS cases,
        (SELECT COUNT(*)::int FROM defect) AS defects
    `);
    res.json({ ok: true, summary, counts: counts.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// API documentation endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'InsightI Pre/Post Inspection API',
    version: APP_VERSION, // Error handling improvements
    endpoints: {
      auth: '/api/auth',
      cases: '/api/cases',
      defects: '/api/defects',
      defectCategories: '/api/defect-categories',
      inspections: '/api/inspections', // NEW: Equipment inspections
      inspectorRegistration: '/api/inspector-registration', // NEW: Inspector registration
      pushNotifications: '/api/push', // NEW: Push notifications
      youtubeSearch: '/api/youtube', // NEW: YouTube 실시간 검색
      aiLearning: '/api/ai-learning',
      azureAI: '/api/azure-ai',
          aiDetection: '/api/ai-detection',
      upload: '/api/upload',
      reports: '/api/reports',
      sms: '/api/sms',
      admin: '/api/admin'
    }
  });
});

// Error handling middleware (중앙화된 에러 핸들러 사용)
const { errorHandler } = require('./utils/errorHandler');
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
const PORT = config.port || process.env.PORT || 3000;

console.log(`🔧 Starting server on port ${PORT}...`);
console.log(`📊 NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
console.log(`📊 DATABASE_URL: ${process.env.DATABASE_URL ? 'Set' : 'Not set'}`);
console.log(`📊 RENDER_REGION: ${process.env.RENDER_REGION || 'singapore (default)'}`);
try {
  const { resolveDatabaseUrl } = require('./utils/databaseUrl');
  const resolved = resolveDatabaseUrl();
  if (resolved) {
    console.log(`📊 Resolved DB host: ${new URL(resolved).hostname}`);
  }
} catch (e) {
  console.warn('⚠️ DATABASE_URL resolve warning:', e.message);
}

// Start server with error handling
const pool = require('./database');
const { ensureInspectorHousehold } = require('./utils/ensureInspectorHousehold');
const { bootstrapDatabase } = require('./utils/bootstrapDatabase');
const { ensureInspectionSchema } = require('./utils/ensureInspectionSchema');

async function prepareDatabase() {
  const bootstrap = await bootstrapDatabase(pool);
  if (!bootstrap.ok) {
    console.warn('[startup] DB bootstrap failed:', bootstrap.reason);
  }
  try {
    const schema = await ensureInspectionSchema(pool);
    console.log('[startup] inspection schema:', schema.ok ? 'ready' : 'incomplete');
  } catch (error) {
    console.warn('[startup] inspection schema ensure failed:', error.message);
  }
  await ensureInspectorHousehold(pool);
  try {
    const { backfillUploadsFromDisk } = require('./utils/fileStorage');
    const uploadDirForBackfill = path.isAbsolute(config.upload.dir)
      ? config.upload.dir
      : path.join(__dirname, config.upload.dir);
    await backfillUploadsFromDisk(uploadDirForBackfill);
  } catch (error) {
    console.warn('[startup] upload backfill skipped:', error.message);
  }
}

let server;
prepareDatabase()
  .catch((error) => {
    console.warn('[startup] DB prepare error:', error.message);
  })
  .finally(() => {
    try {
      server = app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`📚 API Documentation: http://localhost:${PORT}/api`);
        console.log(`🏥 Health Check: http://localhost:${PORT}/health?db=1`);
        console.log(`✅ Server is ready to accept connections`);
        console.log(`🌐 Server listening on 0.0.0.0:${PORT}`);
      });
    } catch (error) {
      console.error('❌ Failed to start server:', error);
      console.error('Error stack:', error.stack);
      process.exit(1);
    }

    server.on('error', (error) => {
      console.error('❌ Server error:', error);
      if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use`);
      }
      process.exit(1);
    });
  });

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

module.exports = app;
