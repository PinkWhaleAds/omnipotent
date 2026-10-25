import { AccessProvider } from '@configs/access.config';

/**
 * Import the guard with the environment it should see: `@constants` resolves `ENV` once, at import,
 * from `NODE_ENV`.
 *
 * @param env - The environment the guard runs in
 * @returns The guard and the provider production requires
 */
async function withEnv(env: string): Promise<{
  assertTenancyProviderAllowed: (provider: AccessProvider) => void;
  PRODUCTION_PROVIDER: AccessProvider;
}> {
  let guard!: typeof import('@src/services/tenancy-provider');
  await jest.isolateModulesAsync(async (): Promise<void> => {
    jest.doMock('@constants', () => ({ ...jest.requireActual('@constants'), ENV: env }));
    guard = await import('@src/services/tenancy-provider');
  });
  return guard;
}

describe('Unit::Services::TenancyProvider', () => {
  afterEach((): void => {
    jest.resetModules();
    jest.dontMock('@constants');
  });

  describe('assertTenancyProviderAllowed', () => {
    it('should let the local implementation run in development and in tests', async (): Promise<void> => {
      for (const env of ['dev', 'test']) {
        const { assertTenancyProviderAllowed } = await withEnv(env);

        expect(() => assertTenancyProviderAllowed('local')).not.toThrow();
      }
    });

    it('should refuse to start production with the local implementation, naming D43', async (): Promise<void> => {
      const { assertTenancyProviderAllowed } = await withEnv('prod');

      expect(() => assertTenancyProviderAllowed('local')).toThrow(
        /Access\.provider is "local": production requires "omnipass" \(D43\)/
      );
      expect(() => assertTenancyProviderAllowed('local')).toThrow(/Deploy omnipass first/);
    });

    it('should refuse omnipass everywhere while its client is not wired', async (): Promise<void> => {
      for (const env of ['dev', 'test', 'prod']) {
        const { assertTenancyProviderAllowed, PRODUCTION_PROVIDER } = await withEnv(env);

        expect(PRODUCTION_PROVIDER).toBe('omnipass');
        expect(() => assertTenancyProviderAllowed('omnipass')).toThrow(/is not implemented yet/);
      }
    });
  });
});
