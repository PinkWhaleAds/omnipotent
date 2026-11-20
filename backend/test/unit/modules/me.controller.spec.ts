import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

import { FastifyInstance, LightMyRequestResponse } from 'fastify';

import MeController from '@modules/me/me.controller';
import { JANE } from '@test/unit/mocks/auth.fixtures';
import { closeTestApp, setupRouteAppForTest } from '@test/utils/fastify-test-app.utils';

describe('Unit::Modules::MeController', () => {
  let app: FastifyInstance;

  beforeEach(async (): Promise<void> => {
    app = await setupRouteAppForTest(MeController, {}, JANE);
  });

  afterEach(async (): Promise<void> => {
    await closeTestApp(app);
  });

  it('should answer who the caller is, as omnipass resolved it, with no Organization header', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({ method: 'GET', url: '/me' });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual(JANE.tenancy);
  });
});
