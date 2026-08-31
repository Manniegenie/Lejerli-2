require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Server: SocketIOServer } = require('socket.io');

const User = require('./models/user');
const { checkChannelPermission } = require('./middleware/permissions');
const { createMessage, setIo } = require('./services/MessageService');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS
app.set('trust proxy', 1);

const allowedOrigins = [
  process.env.CLIENT_URL,
  'http://localhost:8081',
  'http://localhost:8082',
  'http://localhost:8083',
  'http://localhost:19000',
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

// Cached DB connection (works across serverless invocations; see plan doc —
// deployment is moving to a persistent PM2/VPS process, but this stays
// harmless either way since it's a no-op after the first connect).
let dbConnected = false;
async function connectDB() {
  if (dbConnected) return;
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/lejerli');
  dbConnected = true;
  console.log('✅ MongoDB Connected');
}

// Ensure DB is ready before every request
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    next(err);
  }
});

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/desks', require('./routes/desks'));
app.use('/rooms', require('./routes/rooms'));
app.use('/channels', require('./routes/channels'));
app.use('/me', require('./routes/me'));
app.use('/invites', require('./routes/invites'));

// Health Check
app.get('/', (req, res) => {
  res.send(`🚀 Lejerli API running at ${new Date().toISOString()}`);
});

// Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal Server Error' });
});

// HTTP server wraps the Express app so Socket.IO can share the same port
// (interim — see plan doc re: Vercel vs PM2/VPS; `app` is still exported
// below for the serverless entrypoint, which never reaches this).
const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Authenticate every socket connection the same way `protect` (middleware/auth.js)
// authenticates HTTP requests — jwt.verify against JWT_SECRET, then load the User.
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Not authorized, no token'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) {
      return next(new Error('Not authorized, user not found'));
    }

    socket.user = user;
    next();
  } catch (error) {
    next(new Error('Not authorized, token failed'));
  }
});

io.on('connection', (socket) => {
  // join_channel {channelId} — read-gated via checkChannelPermission, the
  // same single access-control entry point the REST routes use.
  socket.on('join_channel', async (payload) => {
    try {
      const channelId = payload && payload.channelId;
      const permission = await checkChannelPermission(socket.user, channelId, 'read');
      if (!permission.allowed) {
        return socket.emit('error', { message: 'Not permitted' });
      }
      socket.join(channelId.toString());
    } catch (error) {
      console.error('join_channel error:', error.message);
      socket.emit('error', { message: 'Not permitted' });
    }
  });

  // send_message {channelId, text} — write-gated, then persisted and
  // broadcast via the shared createMessage() helper (services/MessageService.js).
  socket.on('send_message', async (payload) => {
    try {
      const channelId = payload && payload.channelId;
      const text = payload && payload.text;
      const permission = await checkChannelPermission(socket.user, channelId, 'write');
      if (!permission.allowed) {
        return socket.emit('error', { message: 'Not permitted' });
      }
      await createMessage({ channelId, senderId: socket.user._id, text });
    } catch (error) {
      console.error('send_message error:', error.message);
      socket.emit('error', { message: 'Not permitted' });
    }
  });
});

setIo(io);

// Export for Vercel serverless (interim — deployment is moving to PM2/VPS, see plan doc)
module.exports = app;

// Only start listener when running locally
if (!process.env.VERCEL) {
  connectDB().then(() => {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🔥 Lejerli server running on port ${PORT}`);
    });
  }).catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });
}
