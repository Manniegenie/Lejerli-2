'use strict';

const { AuditLog } = require('./audit.model');

async function create(data) {
  const log = new AuditLog(data);
  return log.save();
}

async function listByEntity(entity, entityId, { page = 1, limit = 50 } = {}) {
  const skip = (page - 1) * limit;
  const filter = { entity, entityId };

  const [data, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AuditLog.countDocuments(filter),
  ]);

  return { data, total, page, limit };
}

async function listByUser(userId, { page = 1, limit = 50 } = {}) {
  const skip = (page - 1) * limit;
  const filter = { userId };

  const [data, total] = await Promise.all([
    AuditLog.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);

  return { data, total, page, limit };
}

module.exports = { create, listByEntity, listByUser };
