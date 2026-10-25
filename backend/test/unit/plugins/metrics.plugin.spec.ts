import { FastifyInstance, FastifyReply, FastifyRequest, LightMyRequestResponse } from 'fastify';
import { createFastifyAppWithRegistration, closeTestApp } from '@test/utils/fastify-test-app.utils';

jest.mock('@opentelemetry/api');
import openTelemetryApi from '@opentelemetry/api';

import MetricsPlugin from '@src/plugins/metrics.plugin';

describe('Unit::MetricsPlugin', () => {
  let app: FastifyInstance;
  let openTelemetryRecordSpy: jest.Mock;

  beforeEach(async (): Promise<void> => {
    jest.clearAllMocks();

    openTelemetryRecordSpy = jest.fn();
    (openTelemetryApi.metrics.getMeter as jest.Mock).mockReturnValue({
      createHistogram: (): { record: jest.Mock } => ({
        record: openTelemetryRecordSpy,
      }),
    });
    app = await createFastifyAppWithRegistration(MetricsPlugin);
  });

  afterEach(async (): Promise<void> => {
    await closeTestApp(app);
  });

  it('should call the "metric" function on "onResponse" hook', async (): Promise<void> => {
    app.get('/test', async (_: FastifyRequest, reply: FastifyReply): Promise<void> => {
      reply.send({ hello: 'world' });
    });
    await app.ready();

    const response: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/test',
    });

    expect(response.statusCode).toBe(200);
    expect(openTelemetryRecordSpy).toHaveBeenCalledTimes(1);
    expect(openTelemetryRecordSpy).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ method: 'GET', route: '/test', res: 200 })
    );
  });

  it('should label with the route pattern, not the requested URL', async (): Promise<void> => {
    app.get('/foos/:id', async (_: FastifyRequest, reply: FastifyReply): Promise<void> => {
      reply.send({ hello: 'world' });
    });
    await app.ready();

    await app.inject({ method: 'GET', url: '/foos/42?verbose=true' });

    expect(openTelemetryRecordSpy).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ method: 'GET', route: '/foos/:id', res: 200 })
    );
  });

  it('should use a constant route label when no route matched', async (): Promise<void> => {
    await app.ready();

    const response: LightMyRequestResponse = await app.inject({ method: 'GET', url: '/nope?x=1' });

    expect(response.statusCode).toBe(404);
    expect(openTelemetryRecordSpy).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ method: 'GET', route: '__unmatched__', res: 404 })
    );
  });
});
