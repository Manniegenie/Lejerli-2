'use strict';

/**
 * Unit tests for the §4 permission matrix, enforced by
 * middleware/permissions.js. Models are mocked (matching the convention
 * ported from Lejerli-2/Lejerli/tests/unit/) — this isolates permission
 * logic from route wiring and doesn't need a live database.
 */

jest.mock('../../../models/tradingRoom');
jest.mock('../../../models/desk');
jest.mock('../../../models/partner');
jest.mock('../../../models/roomRoleAssignment');
jest.mock('../../../models/floorMembership');

const TradingRoom = require('../../../models/tradingRoom');
const Desk = require('../../../models/desk');
const Partner = require('../../../models/partner');
const RoomRoleAssignment = require('../../../models/roomRoleAssignment');
const FloorMembership = require('../../../models/floorMembership');
const { requireRoomPermission, requireFloorMembership } = require('../../../middleware/permissions');

const ROOM_ID = 'room-1';
const DESK_ID = 'desk-1';
const PARTNER_ID = 'partner-1';
const PRINCIPAL_ID = 'user-principal';
const PARTNER_USER_ID = 'user-partner';
const OTHER_USER_ID = 'user-other';

function mockReqRes(userId, params = {}) {
  const req = { user: { _id: userId }, params: { roomId: ROOM_ID, deskId: DESK_ID, ...params } };
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const next = jest.fn();
  return { req, res, next };
}

beforeEach(() => {
  jest.clearAllMocks();
  TradingRoom.findById.mockResolvedValue({ _id: ROOM_ID, deskId: DESK_ID, partnerId: PARTNER_ID });
  Desk.findById.mockResolvedValue({ _id: DESK_ID, principalUserId: { toString: () => PRINCIPAL_ID } });
  Partner.findById.mockResolvedValue({ _id: PARTNER_ID, userId: { toString: () => PARTNER_USER_ID }, status: 'ACTIVE' });
  RoomRoleAssignment.findOne.mockResolvedValue(null);
});

describe('requireRoomPermission — Principal', () => {
  it('allows every action, short-circuiting on Desk.principalUserId', async () => {
    for (const action of ['read_line', 'post_line', 'read_backstage', 'post_backstage', 'blotter_read', 'blotter_write']) {
      const { req, res, next } = mockReqRes(PRINCIPAL_ID);
      await requireRoomPermission(action)(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.roomContext.role).toBe('PRINCIPAL');
    }
  });
});

describe('requireRoomPermission — Partner (counterparty)', () => {
  it('allows read_line and post_line on their own room', async () => {
    for (const action of ['read_line', 'post_line']) {
      const { req, res, next } = mockReqRes(PARTNER_USER_ID);
      await requireRoomPermission(action)(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.roomContext.role).toBe('PARTNER');
    }
  });

  it('denies read_backstage and post_backstage — never even distinguished from "no access"', async () => {
    for (const action of ['read_backstage', 'post_backstage', 'blotter_read', 'blotter_write']) {
      const { req, res, next } = mockReqRes(PARTNER_USER_ID);
      await requireRoomPermission(action)(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    }
  });

  it('denies a user who is not this room\'s partner and holds no role assignment', async () => {
    const { req, res, next } = mockReqRes(OTHER_USER_ID);
    await requireRoomPermission('read_line')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});

describe('requireRoomPermission — LEAD', () => {
  beforeEach(() => {
    RoomRoleAssignment.findOne.mockResolvedValue({ role: 'LEAD' });
  });

  it('allows every action', async () => {
    for (const action of ['read_line', 'post_line', 'read_backstage', 'post_backstage', 'blotter_read', 'blotter_write']) {
      const { req, res, next } = mockReqRes(OTHER_USER_ID);
      await requireRoomPermission(action)(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.roomContext.role).toBe('LEAD');
    }
  });
});

describe('requireRoomPermission — TRADER', () => {
  beforeEach(() => {
    RoomRoleAssignment.findOne.mockResolvedValue({ role: 'TRADER' });
  });

  it('cannot post to Line', async () => {
    const { req, res, next } = mockReqRes(OTHER_USER_ID);
    await requireRoomPermission('post_line')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('can read Line, and read/post Backstage and the Blotter', async () => {
    for (const action of ['read_line', 'read_backstage', 'post_backstage', 'blotter_read', 'blotter_write']) {
      const { req, res, next } = mockReqRes(OTHER_USER_ID);
      await requireRoomPermission(action)(req, res, next);
      expect(next).toHaveBeenCalled();
    }
  });
});

describe('requireRoomPermission — OBSERVER', () => {
  beforeEach(() => {
    RoomRoleAssignment.findOne.mockResolvedValue({ role: 'OBSERVER' });
  });

  it('is read-only: read_line, read_backstage, blotter_read allowed', async () => {
    for (const action of ['read_line', 'read_backstage', 'blotter_read']) {
      const { req, res, next } = mockReqRes(OTHER_USER_ID);
      await requireRoomPermission(action)(req, res, next);
      expect(next).toHaveBeenCalled();
    }
  });

  it('cannot post_line, post_backstage, or blotter_write', async () => {
    for (const action of ['post_line', 'post_backstage', 'blotter_write']) {
      const { req, res, next } = mockReqRes(OTHER_USER_ID);
      await requireRoomPermission(action)(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    }
  });
});

describe('requireRoomPermission — no assignment', () => {
  it('denies a floor member with no RoomRoleAssignment for this room', async () => {
    const { req, res, next } = mockReqRes(OTHER_USER_ID);
    await requireRoomPermission('read_backstage')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});

describe('requireRoomPermission — room not found', () => {
  it('returns 404 when the room does not exist', async () => {
    TradingRoom.findById.mockResolvedValue(null);
    const { req, res, next } = mockReqRes(PRINCIPAL_ID);
    await requireRoomPermission('read_line')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(404);
  });
});

describe('requireFloorMembership', () => {
  it('allows an active floor member', async () => {
    FloorMembership.findOne.mockResolvedValue({ status: 'ACTIVE' });
    const { req, res, next } = mockReqRes(OTHER_USER_ID);
    await requireFloorMembership()(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('denies a user with no active membership on the desk', async () => {
    FloorMembership.findOne.mockResolvedValue(null);
    const { req, res, next } = mockReqRes(OTHER_USER_ID);
    await requireFloorMembership()(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});
