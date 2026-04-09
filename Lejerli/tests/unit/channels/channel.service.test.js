'use strict';

/**
 * Unit tests for ChannelService.
 * All external dependencies (channelRepository, auditService, redis) are mocked.
 */

jest.mock('../../../src/modules/channels/channel.repository');
jest.mock('../../../src/modules/audit/audit.service');
jest.mock('../../../src/infrastructure/cache/redis');

const channelService = require('../../../src/modules/channels/channel.service');
const channelRepository = require('../../../src/modules/channels/channel.repository');
const { cacheGet, cacheSet, cacheDel } = require('../../../src/infrastructure/cache/redis');
const { NotFoundError, ConflictError } = require('../../../src/utils/errors');

// ── Fixtures ─────────────────────────────────────────────────────────────

const mockChannel = {
  _id: '665f000000000000000000a1',
  name: 'BTC-OTC',
  type: 'CRYPTO',
  asset: 'BTC',
  rateMode: 'MANUAL',
  otcRate: 63000,
  markupPercentage: 0,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ── Setup / Teardown ──────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  cacheGet.mockResolvedValue(null);
  cacheSet.mockResolvedValue(undefined);
  cacheDel.mockResolvedValue(undefined);
});

// ── createChannel ─────────────────────────────────────────────────────────

describe('createChannel', () => {
  it('creates a new channel when name is unique', async () => {
    channelRepository.findByName.mockResolvedValue(null);
    channelRepository.create.mockResolvedValue(mockChannel);

    const result = await channelService.createChannel(
      { name: 'BTC-OTC', type: 'CRYPTO', asset: 'BTC', otcRate: 63000 },
      'user123'
    );

    expect(channelRepository.findByName).toHaveBeenCalledWith('BTC-OTC');
    expect(channelRepository.create).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ name: 'BTC-OTC', type: 'CRYPTO' });
    expect(cacheDel).toHaveBeenCalled(); // cache invalidated
  });

  it('throws ConflictError when channel name already exists', async () => {
    channelRepository.findByName.mockResolvedValue(mockChannel);

    await expect(
      channelService.createChannel({ name: 'BTC-OTC', type: 'CRYPTO' }, 'user123')
    ).rejects.toThrow(ConflictError);

    expect(channelRepository.create).not.toHaveBeenCalled();
  });
});

// ── getChannelById ────────────────────────────────────────────────────────

describe('getChannelById', () => {
  it('returns cached channel when cache hit', async () => {
    cacheGet.mockResolvedValue(mockChannel);

    const result = await channelService.getChannelById(mockChannel._id);

    expect(result).toEqual(mockChannel);
    expect(channelRepository.findById).not.toHaveBeenCalled();
  });

  it('fetches from DB on cache miss and populates cache', async () => {
    cacheGet.mockResolvedValue(null);
    channelRepository.findById.mockResolvedValue(mockChannel);

    const result = await channelService.getChannelById(mockChannel._id);

    expect(channelRepository.findById).toHaveBeenCalledWith(mockChannel._id);
    expect(cacheSet).toHaveBeenCalled();
    expect(result).toEqual(mockChannel);
  });

  it('throws NotFoundError when channel does not exist', async () => {
    cacheGet.mockResolvedValue(null);
    channelRepository.findById.mockResolvedValue(null);

    await expect(channelService.getChannelById('nonexistent')).rejects.toThrow(NotFoundError);
  });
});

// ── updateChannel ─────────────────────────────────────────────────────────

describe('updateChannel', () => {
  it('updates channel and busts cache', async () => {
    channelRepository.findById.mockResolvedValue(mockChannel);
    channelRepository.updateById.mockResolvedValue({ ...mockChannel, markupPercentage: 1.5 });

    const result = await channelService.updateChannel(
      mockChannel._id,
      { markupPercentage: 1.5 },
      'admin123'
    );

    expect(result.markupPercentage).toBe(1.5);
    expect(cacheDel).toHaveBeenCalledTimes(2); // channel key + active list
  });

  it('throws NotFoundError when channel missing', async () => {
    channelRepository.findById.mockResolvedValue(null);

    await expect(
      channelService.updateChannel('bad-id', {}, 'admin123')
    ).rejects.toThrow(NotFoundError);
  });
});

// ── toggleActive ──────────────────────────────────────────────────────────

describe('toggleActive', () => {
  it('deactivates an active channel', async () => {
    channelRepository.findById.mockResolvedValue({ ...mockChannel, isActive: true });
    channelRepository.deactivate.mockResolvedValue({ ...mockChannel, isActive: false });

    const result = await channelService.toggleActive(mockChannel._id, 'admin123');

    expect(channelRepository.deactivate).toHaveBeenCalledWith(mockChannel._id);
    expect(result.isActive).toBe(false);
  });

  it('activates an inactive channel', async () => {
    channelRepository.findById.mockResolvedValue({ ...mockChannel, isActive: false });
    channelRepository.activate.mockResolvedValue({ ...mockChannel, isActive: true });

    const result = await channelService.toggleActive(mockChannel._id, 'admin123');

    expect(channelRepository.activate).toHaveBeenCalledWith(mockChannel._id);
    expect(result.isActive).toBe(true);
  });
});
