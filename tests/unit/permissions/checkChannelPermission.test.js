'use strict';

/**
 * Unit tests for checkChannelPermission — the single access-control entry
 * point both the REST message routes (routes/channels.js) and the socket
 * layer (server.js) call. LINE/BACKSTAGE channels must dispatch into the
 * §4 room permission matrix (checkRoomPermission) against the channel's
 * roomId; FLOOR channels must dispatch into checkFloorMembership against
 * the channel's deskId. Mirrors the jest.mock()-the-models convention from
 * tests/unit/permissions/permissions.test.js — no live DB needed.
 */

jest.mock('../../../models/channel');
jest.mock('../../../models/tradingRoom');
jest.mock('../../../models/desk');
jest.mock('../../../models/partner');
jest.mock('../../../models/roomRoleAssignment');
jest.mock('../../../models/floorMembership');

const Channel = require('../../../models/channel');
const TradingRoom = require('../../../models/tradingRoom');
const Desk = require('../../../models/desk');
const Partner = require('../../../models/partner');
const RoomRoleAssignment = require('../../../models/roomRoleAssignment');
const FloorMembership = require('../../../models/floorMembership');
const { checkChannelPermission } = require('../../../middleware/permissions');

const ROOM_ID = 'room-1';
const DESK_ID = 'desk-1';
const PARTNER_ID = 'partner-1';
const LINE_CHANNEL_ID = 'channel-line';
const BACKSTAGE_CHANNEL_ID = 'channel-backstage';
const FLOOR_CHANNEL_ID = 'channel-floor';
const PRINCIPAL_ID = 'user-principal';
const PARTNER_USER_ID = 'user-partner';
const OTHER_USER_ID = 'user-other';

function userOf(id) {
  return { _id: id };
}

beforeEach(() => {
  jest.clearAllMocks();
  TradingRoom.findById.mockResolvedValue({ _id: ROOM_ID, deskId: DESK_ID, partnerId: PARTNER_ID });
  Desk.findById.mockResolvedValue({ _id: DESK_ID, principalUserId: { toString: () => PRINCIPAL_ID } });
  Partner.findById.mockResolvedValue({ _id: PARTNER_ID, userId: { toString: () => PARTNER_USER_ID }, status: 'ACTIVE' });
  RoomRoleAssignment.findOne.mockResolvedValue(null);
  FloorMembership.findOne.mockResolvedValue(null);
});

describe('checkChannelPermission — LINE channel', () => {
  beforeEach(() => {
    Channel.findById.mockResolvedValue({ _id: LINE_CHANNEL_ID, type: 'LINE', roomId: ROOM_ID });
  });

  it('dispatches read mode to read_line (partner allowed on their own room)', async () => {
    const result = await checkChannelPermission(userOf(PARTNER_USER_ID), LINE_CHANNEL_ID, 'read');
    expect(result.allowed).toBe(true);
    expect(result.role).toBe('PARTNER');
    expect(TradingRoom.findById).toHaveBeenCalledWith(ROOM_ID);
  });

  it('dispatches write mode to post_line (partner allowed on their own room)', async () => {
    const result = await checkChannelPermission(userOf(PARTNER_USER_ID), LINE_CHANNEL_ID, 'write');
    expect(result.allowed).toBe(true);
  });

  it('denies write for a role without post_line (TRADER)', async () => {
    RoomRoleAssignment.findOne.mockResolvedValue({ role: 'TRADER' });
    const result = await checkChannelPermission(userOf(OTHER_USER_ID), LINE_CHANNEL_ID, 'write');
    expect(result.allowed).toBe(false);
  });

  it('allows read for any assigned role (OBSERVER)', async () => {
    RoomRoleAssignment.findOne.mockResolvedValue({ role: 'OBSERVER' });
    const result = await checkChannelPermission(userOf(OTHER_USER_ID), LINE_CHANNEL_ID, 'read');
    expect(result.allowed).toBe(true);
  });
});

describe('checkChannelPermission — BACKSTAGE channel', () => {
  beforeEach(() => {
    Channel.findById.mockResolvedValue({ _id: BACKSTAGE_CHANNEL_ID, type: 'BACKSTAGE', roomId: ROOM_ID });
  });

  it('dispatches read mode to read_backstage for a floor role', async () => {
    RoomRoleAssignment.findOne.mockResolvedValue({ role: 'TRADER' });
    const result = await checkChannelPermission(userOf(OTHER_USER_ID), BACKSTAGE_CHANNEL_ID, 'read');
    expect(result.allowed).toBe(true);
  });

  it('dispatches write mode to post_backstage for a floor role (LEAD)', async () => {
    RoomRoleAssignment.findOne.mockResolvedValue({ role: 'LEAD' });
    const result = await checkChannelPermission(userOf(OTHER_USER_ID), BACKSTAGE_CHANNEL_ID, 'write');
    expect(result.allowed).toBe(true);
  });

  it('denies an OBSERVER write on backstage (read-only role)', async () => {
    RoomRoleAssignment.findOne.mockResolvedValue({ role: 'OBSERVER' });
    const result = await checkChannelPermission(userOf(OTHER_USER_ID), BACKSTAGE_CHANNEL_ID, 'write');
    expect(result.allowed).toBe(false);
  });

  it('partner boundary — the connected partner is denied Backstage read on their own room', async () => {
    const result = await checkChannelPermission(userOf(PARTNER_USER_ID), BACKSTAGE_CHANNEL_ID, 'read');
    expect(result.allowed).toBe(false);
  });

  it('partner boundary — the connected partner is denied Backstage write on their own room', async () => {
    const result = await checkChannelPermission(userOf(PARTNER_USER_ID), BACKSTAGE_CHANNEL_ID, 'write');
    expect(result.allowed).toBe(false);
  });
});

describe('checkChannelPermission — FLOOR channel', () => {
  beforeEach(() => {
    Channel.findById.mockResolvedValue({ _id: FLOOR_CHANNEL_ID, type: 'FLOOR', deskId: DESK_ID });
  });

  it('dispatches to floor membership — allows an active member', async () => {
    FloorMembership.findOne.mockResolvedValue({ status: 'ACTIVE' });
    const result = await checkChannelPermission(userOf(OTHER_USER_ID), FLOOR_CHANNEL_ID, 'read');
    expect(result.allowed).toBe(true);
    expect(FloorMembership.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ deskId: DESK_ID, status: 'ACTIVE' })
    );
    // FLOOR dispatch never touches the room permission tables.
    expect(TradingRoom.findById).not.toHaveBeenCalled();
  });

  it('dispatches to floor membership — denies a non-member on write', async () => {
    FloorMembership.findOne.mockResolvedValue(null);
    const result = await checkChannelPermission(userOf(OTHER_USER_ID), FLOOR_CHANNEL_ID, 'write');
    expect(result.allowed).toBe(false);
  });
});

describe('checkChannelPermission — unknown/missing channel', () => {
  it('returns allowed:false when the channel does not exist', async () => {
    Channel.findById.mockResolvedValue(null);
    const result = await checkChannelPermission(userOf(OTHER_USER_ID), 'missing-channel', 'read');
    expect(result.allowed).toBe(false);
    expect(result.role).toBeNull();
  });
});
