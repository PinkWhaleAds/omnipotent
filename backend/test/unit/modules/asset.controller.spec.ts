import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

import { FastifyInstance, LightMyRequestResponse } from 'fastify';

import AssetController from '@modules/asset/asset.controller';
import { IDS, JANE } from '@test/unit/mocks/auth.fixtures';
import { closeTestApp, setupRouteAppForTest } from '@test/utils/fastify-test-app.utils';
import { httpError } from '@utils';

/** The asset and the Advertiser the routes name. */
const ASSET_ID = 'fc000000-0000-4000-8000-000000000001';
const ADVERTISER_ID = IDS.advertiser;

/** Headers of every call: the Organization the caller acts in. */
const HEADERS: Record<string, string> = { 'x-organization-id': IDS.organization };

/** An instant, as the API writes it. */
const ISO: string = new Date('2026-10-06T10:00:00.000Z').toISOString();

/** What the asset routes answer, checked against their real response schema. */
const ASSET = {
  id: ASSET_ID,
  organizationId: IDS.organization,
  advertiserId: ADVERTISER_ID,
  fileName: 'banniere.png',
  kind: 'image',
  mimeType: 'image/png',
  sizeBytes: 33,
  width: 300,
  height: 250,
  durationMs: null,
  fingerprint: 'a'.repeat(64),
  provenance: 'uploaded',
  aiGenerationId: null,
  downloadUrl: 'https://storage.test/banniere.png',
  labels: [],
  createdAt: ISO,
  updatedAt: ISO,
  deletedAt: null,
};

/** The boundary every multipart body of these specs uses. */
const BOUNDARY = '----omnipotentspec';

/**
 * Build a multipart body: one file part, and the text fields beside it.
 *
 * @param file - The file part, when one is sent
 * @param fields - The text fields
 * @returns The body
 */
function multipart(
  file: { name: string; type: string; data: Buffer } | null,
  fields: Record<string, string> = {}
): Buffer {
  const parts: Buffer[] = [];
  if (file) {
    parts.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
          `Content-Type: ${file.type}\r\n\r\n`
      ),
      file.data,
      Buffer.from('\r\n')
    );
  }
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(parts);
}

describe('Unit::Modules::AssetController', () => {
  let app: FastifyInstance;
  let service: Record<string, jest.Mock>;

  beforeEach(async (): Promise<void> => {
    jest.clearAllMocks();
    service = {
      list: jest.fn().mockResolvedValue({ items: [ASSET], total: 1, page: 1, limit: 50 }),
      get: jest.fn().mockResolvedValue(ASSET),
      upload: jest.fn().mockResolvedValue({ asset: ASSET, created: true }),
      update: jest.fn().mockResolvedValue(ASSET),
      delete: jest.fn().mockResolvedValue({ id: ASSET_ID, deletedAt: ISO }),
      restore: jest.fn().mockResolvedValue({ id: ASSET_ID, deletedAt: null }),
      setLabels: jest.fn().mockResolvedValue(ASSET),
    };
    app = await setupRouteAppForTest(AssetController, { assetService: service }, JANE);
  });

  afterEach(async (): Promise<void> => {
    await closeTestApp(app);
  });

  it('should list the assets of an Advertiser, filtered by kind', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: `/advertisers/${ADVERTISER_ID}/assets?kind=video`,
      headers: HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(service.list).toHaveBeenCalledWith(
      JANE,
      IDS.organization,
      ADVERTISER_ID,
      expect.objectContaining({ kind: 'video' })
    );
  });

  it('should upload a file and answer 201, handing the service the bytes and the fields', async (): Promise<void> => {
    const data: Buffer = Buffer.from('les octets');

    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: `/advertisers/${ADVERTISER_ID}/assets`,
      headers: { ...HEADERS, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      payload: multipart({ name: 'banniere.png', type: 'image/png', data }, { durationMs: '15000' }),
    });

    expect(response.statusCode).toBe(201);
    expect(service.upload).toHaveBeenCalledWith(JANE, IDS.organization, ADVERTISER_ID, {
      fileName: 'banniere.png',
      mimeType: 'image/png',
      data,
      durationMs: 15_000,
    });
  });

  it('should answer 200 for bytes the library already had', async (): Promise<void> => {
    service.upload.mockResolvedValue({ asset: ASSET, created: false });

    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: `/advertisers/${ADVERTISER_ID}/assets`,
      headers: { ...HEADERS, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      payload: multipart({ name: 'banniere.png', type: 'image/png', data: Buffer.from('les octets') }),
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ id: ASSET_ID });
  });

  it('should read the labels of an upload as a JSON array', async (): Promise<void> => {
    const label = 'e0000000-0000-4000-8000-000000000001';

    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: `/advertisers/${ADVERTISER_ID}/assets`,
      headers: { ...HEADERS, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      payload: multipart(
        { name: 'banniere.png', type: 'image/png', data: Buffer.from('x') },
        { labelIds: JSON.stringify([label]) }
      ),
    });

    expect(response.statusCode).toBe(201);
    expect(service.upload).toHaveBeenCalledWith(
      JANE,
      IDS.organization,
      ADVERTISER_ID,
      expect.objectContaining({ labelIds: [label] })
    );
  });

  it('should refuse an upload with no file part, naming it', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: `/advertisers/${ADVERTISER_ID}/assets`,
      headers: { ...HEADERS, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      payload: multipart(null, { durationMs: '1000' }),
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      code: 'validation_failed',
      params: { field: 'file', rule: 'required', location: 'body' },
    });
    expect(service.upload).not.toHaveBeenCalled();
  });

  it('should refuse a body that is not multipart', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: `/advertisers/${ADVERTISER_ID}/assets`,
      headers: HEADERS,
      payload: { file: 'nope' },
    });

    expect(response.statusCode).toBe(415);
    expect(JSON.parse(response.body)).toMatchObject({ code: 'multipart_required' });
  });

  it('should refuse a field the upload does not declare, and a bad one, naming it', async (): Promise<void> => {
    const bad: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: `/advertisers/${ADVERTISER_ID}/assets`,
      headers: { ...HEADERS, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      payload: multipart({ name: 'a.png', type: 'image/png', data: Buffer.from('x') }, { durationMs: 'bientôt' }),
    });
    expect(bad.statusCode).toBe(400);
    expect(JSON.parse(bad.body)).toMatchObject({ code: 'validation_failed', params: { field: 'durationMs' } });

    const unknown: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: `/advertisers/${ADVERTISER_ID}/assets`,
      headers: { ...HEADERS, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      payload: multipart({ name: 'a.png', type: 'image/png', data: Buffer.from('x') }, { nope: '1' }),
    });
    expect(unknown.statusCode).toBe(400);
    expect(JSON.parse(unknown.body)).toMatchObject({ code: 'validation_failed', params: { field: 'nope' } });

    const labels: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: `/advertisers/${ADVERTISER_ID}/assets`,
      headers: { ...HEADERS, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      payload: multipart({ name: 'a.png', type: 'image/png', data: Buffer.from('x') }, { labelIds: 'not json' }),
    });
    expect(labels.statusCode).toBe(400);
    expect(JSON.parse(labels.body)).toMatchObject({ code: 'validation_failed', params: { field: 'labelIds' } });
  });

  it('should read, rename, delete and restore flat on the asset', async (): Promise<void> => {
    expect((await app.inject({ method: 'GET', url: `/assets/${ASSET_ID}`, headers: HEADERS })).statusCode).toBe(200);
    expect(service.get).toHaveBeenCalledWith(JANE, IDS.organization, ASSET_ID);

    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/assets/${ASSET_ID}`,
          headers: HEADERS,
          payload: { fileName: 'automne.png' },
        })
      ).statusCode
    ).toBe(200);
    expect(service.update).toHaveBeenCalledWith(JANE, IDS.organization, ASSET_ID, { fileName: 'automne.png' });

    expect((await app.inject({ method: 'DELETE', url: `/assets/${ASSET_ID}`, headers: HEADERS })).statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'POST', url: `/assets/${ASSET_ID}/restore`, headers: HEADERS })).statusCode
    ).toBe(200);
    expect(service.restore).toHaveBeenCalledWith(JANE, IDS.organization, ASSET_ID);
  });

  it('should post the labels of an asset', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'PUT',
      url: `/assets/${ASSET_ID}/labels`,
      headers: HEADERS,
      payload: { labelIds: [] },
    });

    expect(response.statusCode).toBe(200);
    expect(service.setLabels).toHaveBeenCalledWith(JANE, IDS.organization, ASSET_ID, { labelIds: [] });
  });

  it('should relay a refusal of the service in the single error shape', async (): Promise<void> => {
    service.delete.mockRejectedValue(
      httpError(409, 'This asset is used by a creative: delete the creative first', {
        code: 'asset_in_use',
        params: { assetId: ASSET_ID, creatives: 2 },
      })
    );

    const response: LightMyRequestResponse = await app.inject({
      method: 'DELETE',
      url: `/assets/${ASSET_ID}`,
      headers: HEADERS,
    });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body)).toMatchObject({
      code: 'asset_in_use',
      params: { assetId: ASSET_ID, creatives: 2 },
    });
  });

  it('should serve no bulk route: the creation of an asset is bytes', async (): Promise<void> => {
    for (const [method, url] of [
      ['POST', `/advertisers/${ADVERTISER_ID}/assets/bulk`],
      ['PATCH', '/assets/bulk'],
      ['DELETE', '/assets/bulk'],
      ['POST', '/assets/bulk/restore'],
    ] as const) {
      const response: LightMyRequestResponse = await app.inject({ method, url, headers: HEADERS, payload: {} });

      expect([400, 404, 415]).toContain(response.statusCode);
    }
  });
});
