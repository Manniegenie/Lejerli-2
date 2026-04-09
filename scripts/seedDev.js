/**
 * Dev seed script — creates dev@test.com test account
 * Run once: node scripts/seedDev.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/user');

const DEV_EMAIL    = 'dev@test.com';
const DEV_USERNAME = 'devuser';
const DEV_PASSWORD = 'Dev@1234';

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ MongoDB connected');

  const existing = await User.findOne({ email: DEV_EMAIL });
  if (existing) {
    console.log('ℹ️  dev@test.com already exists — skipping.');
    await mongoose.disconnect();
    return;
  }

  await User.create({
    email: DEV_EMAIL,
    username: DEV_USERNAME,
    password: DEV_PASSWORD,
    emailVerified: true,
  });

  console.log('✅ Dev account created:');
  console.log('   Email   :', DEV_EMAIL);
  console.log('   Password:', DEV_PASSWORD);

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seed error:', err.message);
  process.exit(1);
});
