import Fastify, { FastifyInstance, HTTPMethods, RouteOptions } from 'fastify';

import { Controllers, ProbeControllers } from '@modules';
import ValidationPlugin from '@src/plugins/validation.plugin';
import HealthServicePlugin from '@src/services/health.service';
import StatusServicePlugin from '@src/services/status.service';
import { zodSchemaOf } from '@utils';

/** A route, by method and URL pattern. */
type RouteKey = { method: HTTPMethods; url: string };

/**
 * The routes of the reference CRUD of one resource (`backend/docs/phase-2.md` § 2).
 *
 * Every resource of every phase serves these eleven, so a phase that forgets one — a `restore`, a
 * mode of bulk — fails this suite.
 *
 * @param resource - Plural name of the resource, as its URLs carry it
 * @returns Its routes, by method and URL pattern
 */
function crudRoutes(resource: string): RouteKey[] {
  return [
    { method: 'GET', url: `/${resource}` },
    { method: 'POST', url: `/${resource}` },
    { method: 'GET', url: `/${resource}/:id` },
    { method: 'PATCH', url: `/${resource}/:id` },
    { method: 'DELETE', url: `/${resource}/:id` },
    { method: 'POST', url: `/${resource}/:id/restore` },
    { method: 'POST', url: `/${resource}/bulk` },
    { method: 'PATCH', url: `/${resource}/bulk` },
    { method: 'DELETE', url: `/${resource}/bulk` },
    { method: 'POST', url: `/${resource}/bulk/restore` },
  ];
}

/** The probe and status routes, the only ones a worker serves. */
const PROBE_ROUTES: RouteKey[] = [
  { method: 'GET', url: '/livez' },
  { method: 'GET', url: '/readyz' },
  { method: 'GET', url: '/healthz' },
  { method: 'GET', url: '/status' },
];

/**
 * The API routes, served by an `api` process only.
 *
 * Each phase adds the routes of its resource here, next to its controller, and {@link PROBE_ROUTES}
 * stays what a worker answers.
 */
const API_ROUTES: RouteKey[] = [
  { method: 'GET', url: '/.well-known/oauth-protected-resource/mcp' },
  { method: 'GET', url: '/.well-known/oauth-protected-resource' },
  // Phase 2: the reference CRUD, on both resources.
  ...crudRoutes('labels'),
  { method: 'GET', url: '/labels/:id/resources' },
  ...crudRoutes('advertisers'),
  { method: 'PUT', url: '/advertisers/:id/labels' },
];

describe('Unit::Modules::Controllers', () => {
  let app: FastifyInstance;
  let bodies: (RouteKey & { body: unknown })[];

  beforeEach(async (): Promise<void> => {
    bodies = [];
    app = Fastify();
    await app.register(ValidationPlugin);
    app.addHook('onRoute', (route: RouteOptions): void => {
      if (route.schema?.body)
        bodies.push({ method: route.method as HTTPMethods, url: route.url, body: route.schema.body });
    });
    await app.register(HealthServicePlugin);
    await app.register(StatusServicePlugin);
    // Builds every route: a body declared without its Zod schema would make it fail.
    await app.register(Controllers);
    await app.ready();
  });

  afterEach(async (): Promise<void> => {
    await app.close();
  });

  it('should register all controllers and expose the probes', async (): Promise<void> => {
    for (const url of ['/livez', '/readyz', '/healthz']) {
      const response: Awaited<ReturnType<typeof app.inject>> = await app.inject({ method: 'GET', url });
      expect([200, 503]).toContain(response.statusCode);
      expect(JSON.parse(response.body)).toMatchObject({ status: expect.any(String), checks: expect.any(Array) });
    }
  });

  it('should register all controllers and expose /status', async (): Promise<void> => {
    const response: Awaited<ReturnType<typeof app.inject>> = await app.inject({
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

  it('should register every API route', (): void => {
    for (const route of [...PROBE_ROUTES, ...API_ROUTES]) {
      expect({ ...route, registered: app.hasRoute(route) }).toEqual({ ...route, registered: true });
    }
  });

  it('should declare every request body with its Zod schema, which validates it', (): void => {
    // No route of the socle takes a body; a body declared any other way makes its route fail to build
    // (`ValidationPlugin`), so this guards every phase that adds one.
    for (const { method, url, body } of bodies) {
      expect({ method, url, zod: zodSchemaOf(body) !== undefined }).toEqual({ method, url, zod: true });
    }
  });
});

describe('Unit::Modules::ProbeControllers', () => {
  let app: FastifyInstance;

  beforeEach(async (): Promise<void> => {
    app = Fastify();
    await app.register(HealthServicePlugin);
    await app.register(StatusServicePlugin);
    await app.register(ProbeControllers);
    await app.ready();
  });

  afterEach(async (): Promise<void> => {
    await app.close();
  });

  it('should register the probe and status routes', async (): Promise<void> => {
    for (const route of PROBE_ROUTES) {
      expect({ ...route, registered: app.hasRoute(route) }).toEqual({ ...route, registered: true });
    }

    const response: Awaited<ReturnType<typeof app.inject>> = await app.inject({ method: 'GET', url: '/livez' });
    expect(response.statusCode).toBe(200);
  });

  it('should not register any API route', (): void => {
    for (const route of API_ROUTES) {
      expect({ ...route, registered: app.hasRoute(route) }).toEqual({ ...route, registered: false });
    }
  });
});
