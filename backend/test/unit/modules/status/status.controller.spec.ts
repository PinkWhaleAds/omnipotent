import { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { setupFastifyAppForTest, closeTestApp } from '@test/utils/fastify-test-app.utils';

import StatusController from '@modules/status/status.controller';
import StatusServicePlugin from '@src/services/status.service';

describe('Unit::StatusController', () => {
  let app: FastifyInstance;

  beforeEach(async (): Promise<void> => {
    app = await setupFastifyAppForTest(StatusController, [StatusServicePlugin]);
  });

  afterEach(async (): Promise<void> => {
    await closeTestApp(app);
  });

  describe('getStatus', () => {
    it('should return valid object', async (): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: '/status',
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({
        app_name: expect.any(String),
        app_version: expect.any(String),
        timestamp: expect.any(Number),
      });
    });
  });
});
