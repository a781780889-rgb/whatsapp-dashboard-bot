jest.mock('../../bot/WhatsAppManager', () => ({
  getSession: jest.fn(),
  isReady: jest.fn(),
}));
jest.mock('../../lib/postgres', () => ({
  queryAll: jest.fn(),
}));

const WhatsAppManager = require('../../bot/WhatsAppManager');
const service = require('./GroupJoinerService');

describe('GroupJoinerService live membership confirmation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    WhatsAppManager.isReady.mockReturnValue(true);
  });

  test('records joined only when WhatsApp metadata contains the current account', async () => {
    const sock = {
      user: { id: '12345:1@s.whatsapp.net' },
      groupAcceptInvite: jest.fn().mockResolvedValue('120363@g.us'),
      groupMetadata: jest.fn().mockResolvedValue({
        participants: [{ id: '12345@s.whatsapp.net' }],
      }),
    };
    WhatsAppManager.getSession.mockReturnValue(sock);

    const result = await service._doJoin('account-1', 'https://chat.whatsapp.com/ABC123456');

    expect(result).toEqual(expect.objectContaining({
      success: true,
      status: 'joined',
      confirmed: true,
      groupId: '120363@g.us',
    }));
    expect(sock.groupMetadata).toHaveBeenCalledWith('120363@g.us');
  });

  test('accepts a confirmed membership represented by a WhatsApp LID', async () => {
    const sock = {
      user: { id: '12345@s.whatsapp.net', lid: '98765@lid' },
      groupAcceptInvite: jest.fn().mockResolvedValue('120363@g.us'),
      groupMetadata: jest.fn().mockResolvedValue({
        participants: [{ id: '98765@lid' }],
      }),
    };
    WhatsAppManager.getSession.mockReturnValue(sock);

    const result = await service._doJoin('account-1', 'https://chat.whatsapp.com/ABC123456');

    expect(result).toEqual(expect.objectContaining({
      success: true,
      status: 'joined',
      confirmed: true,
    }));
  });

  test('does not record success when WhatsApp does not confirm membership', async () => {
    const sock = {
      user: { id: '12345@s.whatsapp.net' },
      groupAcceptInvite: jest.fn().mockResolvedValue('120363@g.us'),
      groupMetadata: jest.fn().mockResolvedValue({ participants: [] }),
    };
    WhatsAppManager.getSession.mockReturnValue(sock);

    const result = await service._doJoin('account-1', 'https://chat.whatsapp.com/ABC123456');

    expect(result.success).toBe(false);
    expect(result.status).toBe('retry');
    expect(result.confirmed).toBe(false);
  });
});

 afterAll(() => {
  jest.restoreAllMocks();
});
