'use strict';

require('dotenv').config();

const { connectDatabase, disconnectDatabase } = require('../Lejerli/src/infrastructure/database/mongoose');
const userService = require('../Lejerli/src/modules/users/user.service');

async function main() {
  await connectDatabase();

  try {
    const user = await userService.createUser({
      email: 'oakunne@gmail.com',
      password: 'Test1234',
      role: 'TRADER',
    });
    console.log('Test account created:', user);
  } catch (err) {
    console.error('Failed to create user:', err.message);
  } finally {
    await disconnectDatabase();
  }
}

main();
