require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS
app.set('trust proxy', 1);

const allowedOrigins = [
  process.env.CLIENT_URL,
  'http://localhost:8081',
  'http://localhost:19006',
  'https://www.lejerli.com',
  'https://lejerli.com',
].filter(Boolean);

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      console.warn(`CORS blocked: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

// Logging & Security
app.use(morgan('combined'));
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate Limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { success: false, error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(apiLimiter);

// JWT Auth Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, error: 'Unauthorized: No token provided.' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, error: 'Forbidden: Invalid token.' });
    req.user = user;
    next();
  });
};

// Public Routes
app.use('/signin', require('./routes/signin'));
app.use('/signup', require('./routes/signup'));
app.use('/verify', require('./routes/verify'));
app.use('/news',   require('./routes/news'));    // Economic news feed
app.use('/clocks', require('./routes/clocks')); // World clock times for all timezones
app.use('/tokens',    require('./routes/tokens'));    // Token icon map from CoinGecko
app.use('/exchanges', require('./routes/exchanges')); // Supported CEX list + logos

// Protected Routes
app.use('/sync',     authenticateToken, require('./routes/sync'));     // 12-month historical data sync
app.use('/wallet',   authenticateToken, require('./routes/wallet'));
app.use('/coinbase', authenticateToken, require('./routes/coinbase')); // Coinbase Advanced Trade
app.use('/bybit',    authenticateToken, require('./routes/bybit'));    // Bybit v5
app.use('/phantom',  authenticateToken, require('./routes/phantom'));  // Phantom/Solana
app.use('/channels', authenticateToken, require('./routes/channels')); // Connected channel rows
app.use('/trees',    authenticateToken, require('./routes/trees'));    // Asset tracking trees

// Health Check
app.get('/', (req, res) => {
  res.send(`🚀 Lejerli API running at ${new Date().toISOString()}`);
});

// Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal Server Error' });
});

// Start
mongoose
  .connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/lejerli')
  .then(() => {
    console.log('✅ MongoDB Connected');
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🔥 Lejerli server running on port ${PORT}`);
    });
    // Start background jobs after DB is ready
    require('./jobs/balancePoller').start();
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });
