import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { Readable } from 'node:stream';

import { StorageConfig, storageConfig } from '@configs/storage.config';
import { LoggerBuilder, Logger } from '@utils';

/** Signs a download URL; injectable for tests. */
export type UrlSigner = (
  client: S3Client,
  command: GetObjectCommand,
  options: { expiresIn: number }
) => Promise<string>;

/**
 * Build the S3 client options from the storage configuration.
 *
 * On AWS the endpoint and keys are empty: the SDK resolves the regional endpoint
 * and the credentials of the IAM role. Locally they point at RustFS.
 *
 * @param config - Storage configuration
 * @returns Options for `new S3Client(...)`
 */
export function buildS3ClientConfig(config: StorageConfig): S3ClientConfig {
  return {
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    ...(config.accessKeyId
      ? { credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }
      : {}),
  };
}

/**
 * Object storage of the files the application keeps (S3, or RustFS locally).
 *
 * Objects are private; they are read through short-lived presigned URLs.
 */
export class StorageService {
  /** @internal Logger scoped to this class. */
  private readonly logger: Logger = LoggerBuilder.getChildLogger('StorageService');

  /**
   * Create the service.
   *
   * @param client - S3 client
   * @param config - Storage configuration
   * @param signer - Presigned URL signer (the AWS SDK's by default)
   */
  constructor(
    private readonly client: S3Client,
    private readonly config: StorageConfig,
    private readonly signer: UrlSigner = getSignedUrl as UrlSigner
  ) {}

  /**
   * Store an object.
   *
   * @param key - Object key
   * @param body - Content
   * @param contentType - MIME type, served back on download
   * @returns A promise that resolves once stored
   */
  public async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: body, ContentType: contentType })
    );
  }

  /**
   * Read an object.
   *
   * @param key - Object key
   * @returns Its content
   */
  public async get(key: string): Promise<Buffer> {
    const output = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
    return Buffer.from(await (output.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray());
  }

  /**
   * Read an object as a stream, never whole in memory.
   *
   * @param key - Object key
   * @returns Its content, to be read once
   */
  public async stream(key: string): Promise<Readable> {
    const output = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
    return output.Body as Readable;
  }

  /**
   * The size and entity tag of an object, without reading it.
   *
   * @param key - Object key
   * @returns Its size in bytes and its entity tag (quoted, as S3 gives it), `null` when it does not exist
   */
  public async stat(key: string): Promise<{ size: number; etag: string } | null> {
    try {
      const output = await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return { size: output.ContentLength ?? 0, etag: output.ETag ?? '' };
    } catch (error: unknown) {
      if (error instanceof Error && (error.name === 'NotFound' || error.name === 'NoSuchKey')) return null;
      throw error;
    }
  }

  /**
   * A temporary download URL for an object.
   *
   * @param key - Object key
   * @returns A URL valid `Storage.presignTtl` seconds
   */
  public async downloadUrl(key: string): Promise<string> {
    return this.signer(this.client, new GetObjectCommand({ Bucket: this.config.bucket, Key: key }), {
      expiresIn: this.config.presignTtl,
    });
  }

  /**
   * Create the bucket when it does not exist yet (local development only).
   *
   * Failures are logged, not thrown: uploads fail until the storage is reachable,
   * the rest of the API keeps working.
   *
   * @returns A promise that resolves once the bucket exists or the failure is logged
   */
  public async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.config.bucket }));
        this.logger.info(`Created bucket ${this.config.bucket}`);
      } catch (error: unknown) {
        this.logger.warn(`Could not create bucket ${this.config.bucket}`, { error });
      }
    }
  }
}

/**
 * Fastify plugin that decorates the instance with a {@link StorageService}.
 *
 * With `Storage.createBucket` (local development), creates the bucket in the background.
 *
 * @param fastify - The Fastify instance to decorate
 */
async function storageServicePlugin(fastify: FastifyInstance): Promise<void> {
  const service: StorageService = new StorageService(new S3Client(buildS3ClientConfig(storageConfig)), storageConfig);
  fastify.decorate('storageService', service);
  if (storageConfig.createBucket) void service.ensureBucket();
}

export default fastifyPlugin(storageServicePlugin, {
  name: 'StorageServicePlugin',
});
