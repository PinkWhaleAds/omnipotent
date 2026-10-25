jest.mock('config');
import config from 'config';

describe('Unit::Configs::Access', () => {
  beforeEach((): void => {
    jest.clearAllMocks();
  });

  it('should use default values when no config exists', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((): boolean => false);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { accessConfig } = await import('@configs/access.config');
      expect(accessConfig).toEqual({
        provider: 'local',
        cacheTtl: 60000,
        devActorUserId: '00000000-0000-4000-8000-000000000002',
        devActorEmail: 'dev@omnipotent.local',
        devActorSuperAdmin: true,
      });
    });
  });

  it('should use config values when they exist', async (): Promise<void> => {
    const values: Record<string, unknown> = {
      'Access.provider': 'omnipass',
      'Access.cacheTtl': 30000,
      'Access.devActorUserId': 'a0000000-0000-4000-8000-00000000000a',
      'Access.devActorEmail': 'lorin@omnilor.test',
      'Access.devActorSuperAdmin': false,
    };
    jest.spyOn(config, 'has').mockImplementation((key: string): boolean => key in values);
    jest.spyOn(config, 'get').mockImplementation((key: string): unknown => values[key]);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { accessConfig } = await import('@configs/access.config');
      expect(accessConfig).toEqual({
        provider: 'omnipass',
        cacheTtl: 30000,
        devActorUserId: 'a0000000-0000-4000-8000-00000000000a',
        devActorEmail: 'lorin@omnilor.test',
        devActorSuperAdmin: false,
      });
    });
  });

  it('should treat any non-true value of the super-admin flag as false', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((key: string): boolean => key === 'Access.devActorSuperAdmin');
    jest.spyOn(config, 'get').mockImplementation((): unknown => 'yes');

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { accessConfig } = await import('@configs/access.config');
      expect(accessConfig.devActorSuperAdmin).toBe(false);
    });
  });

  it('should refuse an unknown provider instead of falling back to the stub', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((key: string): boolean => key === 'Access.provider');
    jest.spyOn(config, 'get').mockImplementation((): unknown => 'auth0');

    await jest.isolateModulesAsync(async (): Promise<void> => {
      await expect(import('@configs/access.config')).rejects.toThrow("Unknown Access.provider 'auth0'");
    });
  });
});
