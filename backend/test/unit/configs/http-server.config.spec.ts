jest.mock('config');
import config from 'config';

import { parseOrigins } from '@configs/http-server.config';

describe('Unit::Configs::HttpServer', () => {
  describe('parseOrigins', () => {
    it('should read a comma-separated list, without spaces, trailing slashes or empty entries', (): void => {
      expect(parseOrigins(' http://localhost:5173/ , https://app.omnipotent.app,, ')).toEqual([
        'http://localhost:5173',
        'https://app.omnipotent.app',
      ]);
    });

    it.each([[''], [null], [undefined], [42]])('should read no origin from %p', (value: unknown): void => {
      expect(parseOrigins(value)).toEqual([]);
    });
  });

  it('should read the CORS origins of the configuration', async (): Promise<void> => {
    const values: Record<string, unknown> = {
      'HttpServer.host': '0.0.0.0',
      'HttpServer.port': 3000,
      'HttpServer.corsOrigins': 'http://localhost:5173',
    };
    jest.spyOn(config, 'get').mockImplementation((key: string): unknown => values[key]);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { httpServerConfig } = await import('@configs/http-server.config');
      expect(httpServerConfig).toEqual({
        host: '0.0.0.0',
        port: 3000,
        corsOrigins: ['http://localhost:5173'],
        trustProxyHops: 0,
        trustCloudFrontViewerAddress: false,
      });
    });
  });

  it('should read the proxies trusted in front of the server', async (): Promise<void> => {
    const values: Record<string, unknown> = {
      'HttpServer.corsOrigins': '',
      'HttpServer.trustProxyHops': 2,
      'HttpServer.trustCloudFrontViewerAddress': true,
    };
    jest.spyOn(config, 'has').mockImplementation((key: string): boolean => key in values);
    jest.spyOn(config, 'get').mockImplementation((key: string): unknown => values[key]);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { httpServerConfig } = await import('@configs/http-server.config');
      expect(httpServerConfig).toEqual(
        expect.objectContaining({ trustProxyHops: 2, trustCloudFrontViewerAddress: true })
      );
    });
  });
});
