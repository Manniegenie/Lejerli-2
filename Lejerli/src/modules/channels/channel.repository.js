'use strict';

const { Channel } = require('./channel.model');

async function findById(id) {
  return Channel.findById(id).lean();
}

async function findByName(name) {
  return Channel.findOne({ name: name.trim() }).lean();
}

async function create(data) {
  const channel = new Channel(data);
  return channel.save();
}

async function updateById(id, updates) {
  return Channel.findByIdAndUpdate(id, updates, {
    new: true,
    runValidators: true,
  }).lean();
}

async function deactivate(id) {
  return Channel.findByIdAndUpdate(id, { isActive: false }, { new: true }).lean();
}

async function activate(id) {
  return Channel.findByIdAndUpdate(id, { isActive: true }, { new: true }).lean();
}

async function list({ page = 1, limit = 20, type, isActive } = {}) {
  const filter = {};
  if (type) filter.type = type;
  if (isActive !== undefined) filter.isActive = isActive;

  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    Channel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Channel.countDocuments(filter),
  ]);

  return { data, total, page, limit };
}

async function listActive() {
  return Channel.find({ isActive: true }).sort({ name: 1 }).lean();
}

async function listByType(type) {
  return Channel.find({ type, isActive: true }).sort({ name: 1 }).lean();
}

module.exports = {
  findById,
  findByName,
  create,
  updateById,
  deactivate,
  activate,
  list,
  listActive,
  listByType,
};
