'use strict';

const userRepository = require('./user.repository');
const { User } = require('./user.model');
const auditService = require('../audit/audit.service');
const { NotFoundError, ConflictError, UnauthorizedError, BadRequestError } = require('../../utils/errors');
const logger = require('../../utils/logger');

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

async function createUser({ email, password, role }) {
  const existing = await userRepository.findByEmail(email);
  if (existing) throw new ConflictError(`Email ${email} is already registered`);

  const passwordHash = await User.hashPassword(password);
  const user = await userRepository.create({ email, passwordHash, role });

  logger.info({ module: 'users', userId: user._id }, 'User created');

  await auditService.log({
    action: 'CREATE',
    entity: 'User',
    entityId: user._id,
    newValue: { email: user.email, role: user.role },
  });

  return user;
}

async function getUserById(id) {
  const user = await userRepository.findById(id);
  if (!user) throw new NotFoundError('User');
  return user;
}

async function listUsers(filters) {
  return userRepository.list(filters);
}

async function updateUser(id, updates, requestingUserId) {
  const existing = await userRepository.findById(id);
  if (!existing) throw new NotFoundError('User');

  // Prevent direct passwordHash updates via this method
  delete updates.passwordHash;

  const updated = await userRepository.updateById(id, updates);

  await auditService.log({
    userId: requestingUserId,
    action: 'UPDATE',
    entity: 'User',
    entityId: id,
    oldValue: existing,
    newValue: updated,
  });

  return updated;
}

async function deactivateUser(id, requestingUserId) {
  const existing = await userRepository.findById(id);
  if (!existing) throw new NotFoundError('User');

  const updated = await userRepository.deactivate(id);

  await auditService.log({
    userId: requestingUserId,
    action: 'DEACTIVATE',
    entity: 'User',
    entityId: id,
    oldValue: { isActive: true },
    newValue: { isActive: false },
  });

  return updated;
}

/**
 * Authenticate a user by email + password.
 * Implements progressive account lockout on repeated failure.
 */
async function authenticateUser(email, password) {
  const user = await userRepository.findByEmailWithPassword(email);
  if (!user) throw new UnauthorizedError('Invalid credentials');

  if (!user.isActive) throw new UnauthorizedError('Account is inactive');

  if (user.lockUntil && user.lockUntil > Date.now()) {
    const minutesLeft = Math.ceil((user.lockUntil - Date.now()) / 60000);
    throw new UnauthorizedError(`Account locked. Try again in ${minutesLeft} minute(s).`);
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    const updated = await userRepository.incrementLoginAttempts(user._id);
    if (updated.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
      await userRepository.lockAccount(user._id, new Date(Date.now() + LOCK_DURATION_MS));
      throw new UnauthorizedError('Too many failed attempts. Account locked for 15 minutes.');
    }
    throw new UnauthorizedError('Invalid credentials');
  }

  // Successful login — reset counter
  await userRepository.resetLoginAttempts(user._id);
  await userRepository.updateById(user._id, { lastLoginAt: new Date() });

  logger.info({ module: 'users', userId: user._id }, 'User authenticated');

  // Return plain object without password
  const { passwordHash: _, ...safe } = user.toObject ? user.toObject() : user;
  return safe;
}

module.exports = {
  createUser,
  getUserById,
  listUsers,
  updateUser,
  deactivateUser,
  authenticateUser,
};
