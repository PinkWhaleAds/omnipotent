jest.mock('config');
import config from 'config';

describe('Unit::Configs::Omnipass', () => {
  beforeEach((): void => {
    jest.clearAllMocks();
  });

  it('should use default values when no config exists', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((): boolean => false);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { omnipassConfig } = await import('@configs/omnipass.config');

      // `clientId` has no default on purpose: a deployment that chose the omnipass provider without
      // giving it a machine account must be told, not guessed for.
      expect(omnipassConfig).toEqual({
        url: 'http://localhost:3000',
        audience: 'https://api.omnipass.app',
        clientId: '',
        secretName: 'omnipass/client-secret',
      });
    });
  });

  it('should read every configured value', async (): Promise<void> => {
    const values: Record<string, unknown> = {
      'Omnipass.url': 'https://api.omnipass.app',
      'Omnipass.audience': 'https://api.omnipass.app',
      'Omnipass.clientId': 'abc123',
      'Omnipass.secretName': 'omnipass/client-secret-prod',
    };
    jest.spyOn(config, 'has').mockImplementation((): boolean => true);
    jest.spyOn(config, 'get').mockImplementation((key: string): unknown => values[key]);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { omnipassConfig } = await import('@configs/omnipass.config');

      expect(omnipassConfig).toEqual({
        url: 'https://api.omnipass.app',
        audience: 'https://api.omnipass.app',
        clientId: 'abc123',
        secretName: 'omnipass/client-secret-prod',
      });
    });
  });
});
