'use strict';

const userService = require('./user.service');
const { ROLES } = require('./user.model');

/**
 * UserController — HTTP layer only.
 * No business logic lives here. All logic delegated to userService.
 */

async function register(req, reply) {
  const { email, password, role } = req.body;
  const user = await userService.createUser({ email, password, role });
  return reply.code(201).send({ success: true, data: user });
}

async function login(req, reply) {
  const { email, password } = req.body;
  const user = await userService.authenticateUser(email, password);

  const token = await reply.jwtSign(
    { id: user._id, email: user.email, role: user.role },
    { expiresIn: req.server.config.jwt.expiresIn }
  );

  return reply.send({ success: true, data: { user, token } });
}

async function getMe(req, reply) {
  const user = await userService.getUserById(req.user.id);
  return reply.send({ success: true, data: user });
}

async function getUser(req, reply) {
  const user = await userService.getUserById(req.params.id);
  return reply.send({ success: true, data: user });
}

async function listUsers(req, reply) {
  const result = await userService.listUsers(req.query);
  return reply.send({ success: true, ...result });
}

async function updateUser(req, reply) {
  const updated = await userService.updateUser(req.params.id, req.body, req.user.id);
  return reply.send({ success: true, data: updated });
}

async function deactivateUser(req, reply) {
  const updated = await userService.deactivateUser(req.params.id, req.user.id);
  return reply.send({ success: true, data: updated });
}

module.exports = { register, login, getMe, getUser, listUsers, updateUser, deactivateUser };
