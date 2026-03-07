/**
 * Express app setup — middleware, routes, error handling
 */
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { config } = require('./config');
const { apiLimiter } = require('./middleware/rateLimit');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// Route modules
const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/accounts');
const routeRoutes = require('./routes/routes');
const briefRoutes = require('./routes/briefs');
const voiceRoutes = require('./routes/voice');
const recapRoutes = require('./routes/recap');
const stripeRoutes = require('./routes/stripe');

const app = express();

// ─── Security Middleware ─────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", config.supabase.url, 'https://api.openai.com', 'https://maps.googleapis.com'],
        fontSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(
  cors({
    origin: [
      config.appUrl,
      'https://territorypilot.com',
      'https://www.territorypilot.com',
      'https://routeiq-app-production.up.railway.app', // legacy, keep for safety
    ],
    credentials: true,
  })
);

// ─── Logging ─────────────────────────────────────────────────────────────────
app.use(morgan('short'));

// ─── Body Parsing ────────────────────────────────────────────────────────────
// Stripe webhook needs raw body — must come before express.json()
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// ─── Static Files (only public/ directory) ───────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── Health Check ────────────────────────────────────────────────────────────
app.get('/health', (_, res) =>
  res.json({ status: 'ok', ts: new Date().toISOString() })
);

// ─── API Routes ──────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/accounts', apiLimiter, accountRoutes);
app.use('/api/route', apiLimiter, routeRoutes);
app.use('/api/brief', apiLimiter, briefRoutes);
app.use('/api/log/voice', apiLimiter, voiceRoutes);
app.use('/api/recap', apiLimiter, recapRoutes);
app.use('/api/stripe', stripeRoutes);

// ─── 404 + Error Handling ────────────────────────────────────────────────────
app.use('/api/*', notFoundHandler);
app.use(errorHandler);

module.exports = app;
