const mongoose = require('mongoose');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// ─── Reusable sub-schemas ────────────────────────────────────────────────────

// Encrypted exchange connection (Binance / Kraken / Coinbase)
const exchangeConnectionSchema = new mongoose.Schema({
  connected:   { type: Boolean, default: false },
  apiKey:      { type: String, default: null },   // AES-256-CBC encrypted
  apiSecret:   { type: String, default: null },   // AES-256-CBC encrypted
  iv:          { type: String, default: null },   // Hex IV for decryption
  connectedAt: { type: Date,   default: null },
  lastSynced:  { type: Date,   default: null },

  // Last-fetched account snapshot (read-only data from exchange)
  snapshot: {
    uid:          { type: String,  default: null },  // Exchange account UID / user ID
    tier:         { type: String,  default: null },  // Account tier / VIP level
    canTrade:     { type: Boolean, default: null },
    canWithdraw:  { type: Boolean, default: null },
    canDeposit:   { type: Boolean, default: null },
    permissions:  { type: [String], default: [] },   // e.g. ['SPOT','MARGIN']
    feeTier:      { type: String,  default: null },
    // Spot balances at last sync — [{ asset, free, locked, usdValue }]
    balances:     { type: mongoose.Schema.Types.Mixed, default: [] },
    totalUSD:     { type: String, default: null },  // Total portfolio value in USD at last sync
    lastUpdated:  { type: Date, default: null },
  },
}, { _id: false });

// Mono linked bank account
const monoAccountSchema = new mongoose.Schema({
  monoAccountId: { type: String, default: null },  // Mono account._id
  institution: {
    id:         { type: String, default: null },   // Mono institution ID
    name:       { type: String, default: null },   // e.g. "GTBank"
    bankCode:   { type: String, default: null },
    authMethod: { type: String, default: null },   // mobile_banking | internet_banking
    type:       { type: String, default: null },   // bank | microfinance
    country:    { type: String, default: 'NG' },
  },
  accountNumber: { type: String, default: null },
  accountName:   { type: String, default: null },
  accountType:   { type: String, default: null },  // savings | current | wallet
  currency:      { type: String, default: 'NGN' },
  balance:       { type: Number, default: null },  // In kobo (smallest unit)
  status:        { type: String, default: null },  // active | inactive
  linkedAt:      { type: Date,   default: null },
  lastSynced:    { type: Date,   default: null },
  meta: {
    ref: { type: String, default: null },          // Unique ref used in /initiate
  },
}, { _id: false });

// BSC on-chain token holding
const bscTokenSchema = new mongoose.Schema({
  contractAddress: { type: String },
  name:            { type: String },
  symbol:          { type: String },
  decimals:        { type: Number },
  balance:         { type: String },     // Raw balance string (avoid float precision loss)
  balanceUSD:      { type: String, default: null },
  logoUrl:         { type: String, default: null },
}, { _id: false });

// BSC NFT holding
const bscNftSchema = new mongoose.Schema({
  contractAddress: { type: String },
  tokenId:         { type: String },
  name:            { type: String, default: null },
  symbol:          { type: String, default: null },
  collectionName:  { type: String, default: null },
  tokenUri:        { type: String, default: null },
  imageUrl:        { type: String, default: null },
  standard:        { type: String, default: null },  // BEP-721 | BEP-1155
}, { _id: false });

// ─── Main User Schema ────────────────────────────────────────────────────────

const userSchema = new mongoose.Schema({
  email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  username: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true },

  // ── CRYPTO TREE ─────────────────────────────────────────────────────────────
  crypto: {

    // CEX exchange connections
    exchanges: {
      binance:   { type: exchangeConnectionSchema, default: () => ({}) },
      kraken:    { type: exchangeConnectionSchema, default: () => ({}) },
      coinbase:  { type: exchangeConnectionSchema, default: () => ({}) },
      bybit_spot:{ type: exchangeConnectionSchema, default: () => ({}) },
      // DEX wallets — apiKey stores encrypted wallet address, apiSecret stores encrypted ''
      phantom:   { type: exchangeConnectionSchema, default: () => ({}) },
      metamask:  { type: exchangeConnectionSchema, default: () => ({}) },
      trust:     { type: exchangeConnectionSchema, default: () => ({}) },
      jupiter:   { type: exchangeConnectionSchema, default: () => ({}) },
      uniswap:   { type: exchangeConnectionSchema, default: () => ({}) },
      raydium:   { type: exchangeConnectionSchema, default: () => ({}) },
    },

    // On-chain / blockchain connections
    onChain: {

      // BNB Smart Chain (via BscScan API)
      bsc: {
        connected:     { type: Boolean, default: false },
        walletAddress: { type: String,  default: null },  // Public address, no encryption needed
        connectedAt:   { type: Date,    default: null },
        lastSynced:    { type: Date,    default: null },

        snapshot: {
          bnbBalance:        { type: String, default: null },  // In wei
          bnbBalanceUSD:     { type: String, default: null },
          tokenCount:        { type: Number, default: 0 },
          nftCount:          { type: Number, default: 0 },
          transactionCount:  { type: Number, default: 0 },
          firstTxAt:         { type: Date,   default: null },
          lastTxAt:          { type: Date,   default: null },
          lastUpdated:       { type: Date,   default: null },
        },

        tokens: { type: [bscTokenSchema], default: [] },
        nfts:   { type: [bscNftSchema],   default: [] },
      },

      // Extend here: ethereum, polygon, solana, etc.
    },
  },

  // ── FIAT TREE ────────────────────────────────────────────────────────────────
  fiat: {

    // Mono open banking (Nigerian banks)
    mono: {
      connected:      { type: Boolean, default: false },
      monoCustomerId: { type: String,  default: null },  // Mono customer ID
      connectedAt:    { type: Date,    default: null },
      lastSynced:     { type: Date,    default: null },
      accounts:       { type: [monoAccountSchema], default: [] },
    },

    // Extend here: Plaid (US), TrueLayer (UK), etc.
  },

  // ── AUTH & SECURITY ──────────────────────────────────────────────────────────
  loginAttempts:    { type: Number,  default: 0 },
  lockUntil:        { type: Date,    default: null },
  emailVerified:    { type: Boolean, default: false },
  emailOTP:         { type: String,  default: null },
  emailOTPExpiresAt:{ type: Date,    default: null },

}, { timestamps: true });

// ─── Hooks ───────────────────────────────────────────────────────────────────

userSchema.pre('save', async function (next) {
  if (this.isModified('password') && this.password) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }
  next();
});

// ─── Methods ─────────────────────────────────────────────────────────────────

userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

// Encrypt a pair of API keys — returns { apiKey, apiSecret, iv }
userSchema.methods.encryptApiKeys = function (apiKey, apiSecret) {
  const algorithm = 'aes-256-cbc';
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  const iv  = crypto.randomBytes(16);

  const encryptField = (plaintext) => {
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    return cipher.update(plaintext, 'utf8', 'hex') + cipher.final('hex');
  };

  return {
    apiKey:    encryptField(apiKey),
    apiSecret: encryptField(apiSecret),
    iv:        iv.toString('hex'),
  };
};

// Decrypt API keys for a CEX exchange — exchange = 'binance' | 'kraken' | 'coinbase'
userSchema.methods.decryptApiKeys = function (exchange) {
  const conn = this.crypto?.exchanges?.[exchange];
  if (!conn?.apiKey || !conn?.apiSecret || !conn?.iv) return null;

  const algorithm = 'aes-256-cbc';
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  const iv  = Buffer.from(conn.iv, 'hex');

  const decryptField = (ciphertext) => {
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    return decipher.update(ciphertext, 'hex', 'utf8') + decipher.final('utf8');
  };

  return {
    apiKey:    decryptField(conn.apiKey),
    apiSecret: decryptField(conn.apiSecret),
  };
};

// True if any CEX or on-chain source is connected
userSchema.methods.hasAnyConnection = function () {
  const ex = this.crypto?.exchanges || {};
  const onChain = this.crypto?.onChain || {};
  const fiat = this.fiat || {};

  return (
    ex.binance?.connected    ||
    ex.kraken?.connected     ||
    ex.coinbase?.connected   ||
    ex.bybit_spot?.connected ||
    ex.phantom?.connected    ||
    onChain.bsc?.connected   ||
    fiat.mono?.connected     ||
    false
  );
};

module.exports = mongoose.model('User', userSchema);
