import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

import type { StorageConfig } from '@configs/storage.config';
const STORAGE_CONFIG_MOCK: StorageConfig = {
  endpoint: 'http://localhost:9010',
  region: 'eu-west-3',
  bucket: 'omnipotent-assets',
  accessKeyId: 'local-access-key',
  secretAccessKey: 'local-secret-key',
  forcePathStyle: true,
  createBucket: false,
  presignTtl: 3600,
  maxUploadBytes: 5242880,
};
jest.mock('@configs/storage.config', () => ({ storageConfig: STORAGE_CONFIG_MOCK }));

import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ClientConfig,
} from '@aws-sdk/client-s3';
import Fastify, { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';

import StorageServicePlugin, { buildS3ClientConfig, StorageService, UrlSigner } from '@src/services/storage.service';

/** Jest mock standing in for the S3 client: only `send` is used. */
type S3ClientMock = { send: jest.Mock };

/** Configuration of the unit tests: AWS-like, no endpoint nor keys. */
const AWS_CONFIG: StorageConfig = {
  endpoint: '',
  region: 'eu-west-3',
  bucket: 'prod-assets',
  accessKeyId: '',
  secretAccessKey: '',
  forcePathStyle: false,
  createBucket: false,
  presignTtl: 900,
  maxUploadBytes: 5242880,
};

/** Let pending promise callbacks and immediates run until the predicate holds. */
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++) {
    await new Promise<void>((resolve: () => void): NodeJS.Immediate => setImmediate(resolve));
  }
  expect(predicate()).toBe(true);
}

describe('Unit::Services::StorageService', () => {
  let client: S3ClientMock;
  let signer: jest.Mock;
  let service: StorageService;

  beforeEach((): void => {
    jest.clearAllMocks();
    STORAGE_CONFIG_MOCK.createBucket = false;
    client = { send: jest.fn().mockResolvedValue({}) };
    signer = jest.fn().mockResolvedValue('https://prod-assets.s3.test/key?X-Amz-Signature=abc');
    service = new StorageService(client as unknown as S3Client, AWS_CONFIG, signer as UrlSigner);
  });

  describe('buildS3ClientConfig', () => {
    it('should leave the endpoint and the credentials to the SDK on AWS', (): void => {
      const options: S3ClientConfig = buildS3ClientConfig(AWS_CONFIG);

      expect(options).toEqual({ region: 'eu-west-3', forcePathStyle: false });
      expect(options).not.toHaveProperty('endpoint');
      expect(options).not.toHaveProperty('credentials');
    });

    it('should point at a local S3-compatible server with static keys', (): void => {
      expect(buildS3ClientConfig(STORAGE_CONFIG_MOCK)).toEqual({
        region: 'eu-west-3',
        forcePathStyle: true,
        endpoint: 'http://localhost:9010',
        credentials: { accessKeyId: 'local-access-key', secretAccessKey: 'local-secret-key' },
      });
    });

    it('should set the endpoint alone when there are no keys', (): void => {
      expect(buildS3ClientConfig({ ...AWS_CONFIG, endpoint: 'https://s3.example.test' })).toEqual({
        region: 'eu-west-3',
        forcePathStyle: false,
        endpoint: 'https://s3.example.test',
      });
    });

    it('should set the credentials alone when there is no endpoint', (): void => {
      expect(buildS3ClientConfig({ ...AWS_CONFIG, accessKeyId: 'key', secretAccessKey: 'secret' })).toEqual({
        region: 'eu-west-3',
        forcePathStyle: false,
        credentials: { accessKeyId: 'key', secretAccessKey: 'secret' },
      });
    });
  });

  describe('put', () => {
    it('should send a PutObjectCommand to the bucket with the content type', async (): Promise<void> => {
      const body: Buffer = Buffer.from('image bytes');

      await expect(service.put('org/adv/asset/logo.png', body, 'image/png')).resolves.toBeUndefined();

      expect(client.send).toHaveBeenCalledTimes(1);
      const command: unknown = client.send.mock.calls[0][0];
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect((command as PutObjectCommand).input).toEqual({
        Bucket: 'prod-assets',
        Key: 'org/adv/asset/logo.png',
        Body: body,
        ContentType: 'image/png',
      });
    });

    it('should propagate a storage failure', async (): Promise<void> => {
      const failure: Error = new Error('connect ECONNREFUSED');
      client.send.mockRejectedValue(failure);

      await expect(service.put('key', Buffer.from('x'), 'image/png')).rejects.toBe(failure);
    });
  });

  describe('get', () => {
    it('should read the object from the bucket as a Buffer', async (): Promise<void> => {
      const transformToByteArray: jest.Mock = jest.fn().mockResolvedValue(new Uint8Array([105, 109, 103]));
      client.send.mockResolvedValue({ Body: { transformToByteArray } });

      const content: Buffer = await service.get('org/adv/asset/square.png');

      expect(Buffer.isBuffer(content)).toBe(true);
      expect(content.toString()).toBe('img');
      expect(client.send).toHaveBeenCalledTimes(1);
      const command: unknown = client.send.mock.calls[0][0];
      expect(command).toBeInstanceOf(GetObjectCommand);
      expect((command as GetObjectCommand).input).toEqual({ Bucket: 'prod-assets', Key: 'org/adv/asset/square.png' });
      expect(transformToByteArray).toHaveBeenCalledTimes(1);
    });

    it('should propagate a storage failure', async (): Promise<void> => {
      const failure: Error = new Error('NoSuchKey');
      client.send.mockRejectedValue(failure);

      await expect(service.get('missing.png')).rejects.toBe(failure);
    });
  });

  describe('stream', () => {
    it('should give the body of the object as it comes, never read whole', async (): Promise<void> => {
      const body = Readable.from([Buffer.from('id\n')]);
      client.send.mockResolvedValue({ Body: body });

      await expect(service.stream('catalogs/c/google.tsv')).resolves.toBe(body);
      const command: unknown = client.send.mock.calls[0][0];
      expect(command).toBeInstanceOf(GetObjectCommand);
      expect((command as GetObjectCommand).input).toEqual({ Bucket: 'prod-assets', Key: 'catalogs/c/google.tsv' });
    });
  });

  describe('stat', () => {
    it('should give the size and tag of an object without reading it', async (): Promise<void> => {
      client.send.mockResolvedValue({ ContentLength: 42, ETag: '"abc"' });

      await expect(service.stat('catalogs/c/google.tsv')).resolves.toEqual({ size: 42, etag: '"abc"' });
      const command: unknown = client.send.mock.calls[0][0];
      expect(command).toBeInstanceOf(HeadObjectCommand);
      expect((command as HeadObjectCommand).input).toEqual({ Bucket: 'prod-assets', Key: 'catalogs/c/google.tsv' });

      client.send.mockResolvedValue({});
      await expect(service.stat('catalogs/c/google.tsv')).resolves.toEqual({ size: 0, etag: '' });
    });

    it.each(['NotFound', 'NoSuchKey'])('should give nothing for a missing object (%s)', async (name: string) => {
      client.send.mockRejectedValue(Object.assign(new Error('missing'), { name }));

      await expect(service.stat('missing')).resolves.toBeNull();
    });

    it('should propagate any other failure', async (): Promise<void> => {
      const failure: Error = new Error('AccessDenied');
      client.send.mockRejectedValueOnce(failure);
      await expect(service.stat('k')).rejects.toBe(failure);

      client.send.mockRejectedValueOnce('weird');
      await expect(service.stat('k')).rejects.toBe('weird');
    });
  });

  describe('downloadUrl', () => {
    it('should sign a GetObjectCommand valid presignTtl seconds', async (): Promise<void> => {
      const url: string = await service.downloadUrl('org/adv/asset/logo.png');

      expect(url).toBe('https://prod-assets.s3.test/key?X-Amz-Signature=abc');
      expect(signer).toHaveBeenCalledTimes(1);
      const [signedClient, command, options] = signer.mock.calls[0] as [unknown, unknown, unknown];
      expect(signedClient).toBe(client);
      expect(command).toBeInstanceOf(GetObjectCommand);
      expect((command as GetObjectCommand).input).toEqual({ Bucket: 'prod-assets', Key: 'org/adv/asset/logo.png' });
      expect(options).toEqual({ expiresIn: 900 });
      expect(client.send).not.toHaveBeenCalled();
    });

    it('should presign with the AWS SDK by default', async (): Promise<void> => {
      const local: StorageService = new StorageService(
        new S3Client(buildS3ClientConfig(STORAGE_CONFIG_MOCK)),
        STORAGE_CONFIG_MOCK
      );

      const url = new URL(await local.downloadUrl('org/adv/asset/logo.png'));

      expect(`${url.origin}${url.pathname}`).toBe('http://localhost:9010/omnipotent-assets/org/adv/asset/logo.png');
      expect(url.searchParams.get('X-Amz-Expires')).toBe('3600');
      expect(url.searchParams.get('X-Amz-Credential')).toMatch(
        /^local-access-key\/\d{8}\/eu-west-3\/s3\/aws4_request$/
      );
      expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('ensureBucket', () => {
    it('should do nothing when the bucket exists', async (): Promise<void> => {
      await expect(service.ensureBucket()).resolves.toBeUndefined();

      expect(client.send).toHaveBeenCalledTimes(1);
      const command: unknown = client.send.mock.calls[0][0];
      expect(command).toBeInstanceOf(HeadBucketCommand);
      expect((command as HeadBucketCommand).input).toEqual({ Bucket: 'prod-assets' });
      expect(loggerMock.info).not.toHaveBeenCalled();
      expect(loggerMock.warn).not.toHaveBeenCalled();
    });

    it('should create the bucket when it is missing', async (): Promise<void> => {
      client.send.mockRejectedValueOnce(new Error('NotFound')).mockResolvedValueOnce({});

      await expect(service.ensureBucket()).resolves.toBeUndefined();

      expect(client.send).toHaveBeenCalledTimes(2);
      const command: unknown = client.send.mock.calls[1][0];
      expect(command).toBeInstanceOf(CreateBucketCommand);
      expect((command as CreateBucketCommand).input).toEqual({ Bucket: 'prod-assets' });
      expect(loggerMock.info).toHaveBeenCalledWith('Created bucket prod-assets');
      expect(loggerMock.warn).not.toHaveBeenCalled();
    });

    it('should log a warning, not throw, when the bucket cannot be created', async (): Promise<void> => {
      const failure: Error = new Error('connect ECONNREFUSED');
      client.send.mockRejectedValueOnce(new Error('NotFound')).mockRejectedValueOnce(failure);

      await expect(service.ensureBucket()).resolves.toBeUndefined();

      expect(client.send).toHaveBeenCalledTimes(2);
      expect(loggerMock.warn).toHaveBeenCalledWith('Could not create bucket prod-assets', { error: failure });
      expect(loggerMock.info).not.toHaveBeenCalled();
    });
  });

  describe('StorageServicePlugin', () => {
    let send: jest.SpyInstance;

    beforeEach((): void => {
      send = jest.spyOn(S3Client.prototype, 'send').mockImplementation(async (): Promise<object> => ({}));
    });

    afterEach((): void => {
      send.mockRestore();
    });

    /**
     * Register the plugin on a fresh instance.
     *
     * @returns The ready instance
     */
    async function buildApp(): Promise<FastifyInstance> {
      const app: FastifyInstance = Fastify();
      await app.register(StorageServicePlugin);
      await app.ready();
      return app;
    }

    it('should decorate the instance with a StorageService on the configured storage', async (): Promise<void> => {
      const app: FastifyInstance = await buildApp();

      expect(app.storageService).toBeInstanceOf(StorageService);
      const url = new URL(await app.storageService.downloadUrl('logo.png'));
      expect(`${url.origin}${url.pathname}`).toBe('http://localhost:9010/omnipotent-assets/logo.png');
      expect(send).not.toHaveBeenCalled();

      await app.close();
    });

    it('should create the bucket in the background when createBucket is set', async (): Promise<void> => {
      STORAGE_CONFIG_MOCK.createBucket = true;

      const app: FastifyInstance = await buildApp();

      await waitFor((): boolean => send.mock.calls.length > 0);
      const command: unknown = send.mock.calls[0][0];
      expect(command).toBeInstanceOf(HeadBucketCommand);
      expect((command as HeadBucketCommand).input).toEqual({ Bucket: 'omnipotent-assets' });

      await app.close();
    });
  });
});
