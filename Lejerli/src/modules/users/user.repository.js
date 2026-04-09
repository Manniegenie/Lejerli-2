'use strict';

const { User } = require('./user.model');

/**
 * UserRepository — all Mongoose queries live here.
 * Services MUST NOT call mongoose directly; they call this layer.
 */

async function findById(id) {
  return User.findById(id).lean();
}

async function findByIdWithPassword(id) {
  return User.findById(id).select('+passwordHash').lean();
}

async function findByEmail(email) {
  return User.findOne({ email: email.toLowerCase() }).lean();
}

async function findByEmailWithPassword(email) {
  return User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
}

async function create(data) {
  const user = new User(data);
  return user.save();
}

async function updateById(id, updates) {
  return User.findByIdAndUpdate(id, updates, { new: true, runValidators: true }).lean();
}

async function deactivate(id) {
  return User.findByIdAndUpdate(id, { isActive: false }, { new: true }).lean();
}

async function incrementLoginAttempts(id) {
  return User.findByIdAndUpdate(
    id,
    { $inc: { loginAttempts: 1 } },
    { new: true }
  ).lean();
}

async function resetLoginAttempts(id) {
  return User.findByIdAndUpdate(
    id,
    { loginAttempts: 0, lockUntil: null },
    { new: true }
  ).lean();
}

async function lockAccount(id, lockUntil) {
  return User.findByIdAndUpdate(id, { lockUntil }, { new: true }).lean();
}

async function list({ page = 1, limit = 20, role, isActive } = {}) {
  const filter = {};
  if (role) filter.role = role;
  if (isActive !== undefined) filter.isActive = isActive;

  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);

  return { data, total, page, limit };
}

module.exports = {
  findById,
  findByIdWithPassword,
  findByEmail,
  findByEmailWithPassword,
  create,
  updateById,
  deactivate,
  incrementLoginAttempts,
  resetLoginAttempts,
  lockAccount,
  list,
};
