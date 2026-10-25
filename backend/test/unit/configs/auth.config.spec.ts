jest.mock('config');
import config from 'config';

describe('Unit::Configs::Auth', () => {
  beforeEach((): void => {
    jest.clearAllMocks();
  });

  it('should use default values when no config exists', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((): boolean => false);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { authConfig } = await import('@configs/auth.config');
      expect(authConfig).toEqual({
        domain: '',
        audience: '',
        jwksCacheTtl: 600000,
        swaggerClientId: '',
      });
    });
  });

  it('should use configured values when they exist', async (): Promise<void> => {
    const values: Record<string, unknown> = {
      'Auth.domain': 'tenant.eu.auth0.com',
      'Auth.audience': 'https://api.omnipotent.io',
      'Auth.jwksCacheTtl': 1000,
      'Auth.swaggerClientId': 'swagger-client-id',
    };
    jest.spyOn(config, 'has').mockImplementation((key: string): boolean => key in values);
    jest.spyOn(config, 'get').mockImplementation((key: string): unknown => values[key]);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { authConfig } = await import('@configs/auth.config');
      expect(authConfig).toEqual({
        domain: 'tenant.eu.auth0.com',
        audience: 'https://api.omnipotent.io',
        jwksCacheTtl: 1000,
        swaggerClientId: 'swagger-client-id',
      });
    });
  });

  it('should carry nothing of the identity: omnipass owns the email, the roles and the super-admin flag', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((): boolean => false);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { authConfig } = await import('@configs/auth.config');

      // T3: no right travels in the token, so none of these has a reason to exist here.
      for (const gone of ['claimNamespace', 'superAdminEmails', 'verifiedEmailProviders', 'identityCacheTtl']) {
        expect(authConfig).not.toHaveProperty(gone);
      }
    });
  });
});
