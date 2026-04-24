'use strict';

const mongoose = require('mongoose');

const email = process.argv[2];
const uri = process.env.MONGODB_URI;

if (!email) { console.error('Usage: MONGODB_URI="..." node scripts/deleteUser.js <email>'); process.exit(1); }
if (!uri)   { console.error('MONGODB_URI env var is required'); process.exit(1); }

mongoose.connect(uri).then(async () => {
  const result = await mongoose.connection.db.collection('users').deleteOne({ email });
  if (result.deletedCount === 0) {
    console.log(`No user found with email: ${email}`);
  } else {
    console.log(`✅ Deleted ${email}`);
  }
}).catch(err => {
  console.error('DB error:', err.message);
}).finally(() => mongoose.disconnect());
