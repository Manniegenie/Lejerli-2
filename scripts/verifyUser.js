'use strict';

const mongoose = require('mongoose');

const email = process.argv[2];
const uri = process.env.MONGODB_URI;

if (!email) { console.error('Usage: MONGODB_URI="..." node scripts/verifyUser.js <email>'); process.exit(1); }
if (!uri)   { console.error('MONGODB_URI env var is required'); process.exit(1); }

mongoose.connect(uri).then(async () => {
  const result = await mongoose.connection.db.collection('users').updateOne(
    { email },
    { $set: { emailVerified: true, emailOTP: null, emailOTPExpiresAt: null } }
  );
  if (result.matchedCount === 0) {
    console.error(`No user found with email: ${email}`);
  } else {
    console.log(`✅ ${email} is now verified`);
  }
}).catch(err => {
  console.error('DB error:', err.message);
}).finally(() => mongoose.disconnect());
