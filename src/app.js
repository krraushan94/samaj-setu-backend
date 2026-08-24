require('dotenv').config();

// Fail fast and loudly rather than booting into a state where every JWT sign/verify call
// either throws or (worse, with some libraries) silently uses an insecure default — this
// should be caught by whoever deploys, not discovered per-request as confusing 500s/401s.
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Refusing to start.');
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { errorHandler } = require('./middleware/errorHandler');
const authRoutes = require('./modules/auth/auth.routes');
const ticketRoutes = require('./modules/tickets/ticket.routes');
const paymentRoutes = require('./modules/payments/payment.routes');
const departmentRoutes = require('./modules/departments/department.routes');
const mediaRoutes = require('./modules/media/media.routes');
const communityRoutes = require('./modules/community/community.routes');
const notificationRoutes = require('./modules/notifications/notification.routes');
const adminRoutes     = require('./modules/admin/admin.routes');
const adminCrudRoutes = require('./modules/admin/admin.crud.routes');
const userRoutes      = require('./modules/users/user.routes');
const visitRoutes     = require('./modules/visits/visit.routes');
const teamworkRoutes  = require('./modules/teamwork/teamwork.routes');

const app = express();

app.use(helmet());
app.use(cors({
  origin: (process.env.ALLOWED_ORIGINS || '').split(','),
  credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Global rate limiter — 200 req/15min per IP
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false }));

app.get('/health', (_req, res) => res.json({ status: 'ok', app: 'Samaj Setu API' }));

app.use('/api/auth', authRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin', adminCrudRoutes);
app.use('/api/users', userRoutes);
app.use('/api/visits', visitRoutes);
app.use('/api/teamwork', teamworkRoutes);

app.use(errorHandler);

const PORT = process.env.PORT || 5000;

// Run migrations then start server — avoids Render health-check timeout
async function startServer() {
  try {
    if (process.env.NODE_ENV === 'production') {
      await require('./db/migrate')();
      await require('./db/migrate_v2')();
      await require('./db/migrate_v3')();
      await require('./db/migrate_v4')();
      await require('./db/migrate_v5')();
      await require('./db/migrate_v6')();
      await require('./db/migrate_v7')();
      await require('./db/migrate_v8')();
      await require('./db/migrate_v9')();
      await require('./db/migrate_v10')();
      await require('./db/migrate_v11')();
      await require('./db/migrate_v12')();
      await require('./db/seed')();
    }
  } catch (err) {
    console.error('Migration/seed warning (continuing):', err.message);
  }
  app.listen(PORT, () => console.log(`Samaj Setu API running on port ${PORT}`));
}

startServer();

module.exports = app;
