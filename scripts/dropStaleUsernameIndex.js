'use strict';

// One-off fix: the pre-rewrite User schema had `username: { required: true,
// unique: true }`. That schema field is gone (see models/user.js), but
// Mongoose never drops indexes for fields removed from the schema — the
// unique index on `username` is still live on the `users` collection in
// Mongo. Every signup since the rewrite has no `username`, so Mongo treats
// it as `username: null`, and the SECOND such document always collides with
// the first, failing with E11000 duplicate key on username_1. This drops
// that stale index. Safe to run multiple times — a already-dropped index
// just no-ops with a clear message.

const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI env var is required'); process.exit(1); }

mongoose.connect(uri).then(async () => {
  const collection = mongoose.connection.db.collection('users');
  const indexes = await collection.indexes();
  console.log('Current indexes on users:', indexes.map(i => i.name));

  const stale = indexes.find(i => i.name === 'username_1');
  if (!stale) {
    console.log('No username_1 index found — nothing to do.');
    return;
  }

  await collection.dropIndex('username_1');
  console.log('✅ Dropped stale username_1 index.');
}).catch(err => {
  console.error('DB error:', err.message);
}).finally(() => mongoose.disconnect());
