'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { connectDatabase, disconnectDatabase } = require('../src/infrastructure/database/mongoose');
const userService = require('../src/modules/users/user.service');

async function main() {
  await connectDatabase();

  try {
    const user = await userService.createUser({
      email: 'oakunne@gmail.com',
      password: 'Test1234',
      role: 'TRADER',
    });
    console.log('Test account created:', JSON.stringify(user, null, 2));
  } catch (err) {
    console.error('Failed:', err.message);
  } finally {
    await disconnectDatabase();
    process.exit(0);
  }
}

main();
