jest.mock('config');
import config from 'config';

describe('Unit::Configs::Geo', () => {
  beforeEach((): void => {
    jest.clearAllMocks();
  });

  it("should keep Amazon Location off by default, in Stockholm, and read Google's page", async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((): boolean => false);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { geoConfig, GOOGLE_GEO_TARGETS_PAGE_URL } = await import('@configs/geo.config');
      expect(GOOGLE_GEO_TARGETS_PAGE_URL).toBe('https://developers.google.com/google-ads/api/data/geotargets');
      expect(geoConfig).toEqual({
        enabled: false,
        region: 'eu-north-1',
        googleTargetsUrl: GOOGLE_GEO_TARGETS_PAGE_URL,
        hourlyLimitPerOrganization: 1000,
        mapStyle: 'Standard',
      });
      expect(config.get).not.toHaveBeenCalled();
    });
  });

  it('should read every configured value', async (): Promise<void> => {
    const values: Record<string, unknown> = {
      'Geo.enabled': true,
      'Geo.region': 'eu-west-1',
      'Geo.googleTargetsUrl': 'https://files.example.com/geotargets.csv.zip',
      'Geo.hourlyLimitPerOrganization': 200,
      'Geo.mapStyle': 'Satellite',
    };
    jest.spyOn(config, 'has').mockImplementation((): boolean => true);
    jest.spyOn(config, 'get').mockImplementation((key: string): unknown => values[key]);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { geoConfig } = await import('@configs/geo.config');
      expect(geoConfig).toEqual({
        enabled: true,
        region: 'eu-west-1',
        googleTargetsUrl: 'https://files.example.com/geotargets.csv.zip',
        hourlyLimitPerOrganization: 200,
        mapStyle: 'Satellite',
      });
    });
  });

  it('should draw standard maps for an unknown style', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((key: string): boolean => key === 'Geo.mapStyle');
    jest.spyOn(config, 'get').mockImplementation((): unknown => 'Hybrid');

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { geoConfig } = await import('@configs/geo.config');
      expect(geoConfig.mapStyle).toBe('Standard');
    });
  });

  it('should be exported by the configuration barrel', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((): boolean => false);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const configs = await import('@configs');
      expect(configs.geoConfig.region).toBe('eu-north-1');
    });
  });
});
