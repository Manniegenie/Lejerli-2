// ─────────────────────────────────────────────────────────────────────────
//  MongoDB init script — runs once on first container startup
//  Creates the lejerli database with proper roles
// ─────────────────────────────────────────────────────────────────────────

db = db.getSiblingDB('lejerli');

db.createUser({
  user: 'lejerli_app',
  pwd: 'lejerli_app_pass',
  roles: [{ role: 'readWrite', db: 'lejerli' }],
});

print('lejerli database and app user created');
