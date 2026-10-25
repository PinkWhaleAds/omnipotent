import config from 'config';

/**
 * Configuration interface for the object storage (S3, or an S3-compatible
 * server such as RustFS locally) holding the files the application keeps.
 *
 * @property endpoint - Custom endpoint for an S3-compatible server; empty on AWS
 * @property region - AWS region of the bucket
 * @property bucket - Bucket holding the files
 * @property accessKeyId - Static credentials for local servers; empty on AWS (the IAM role is used)
 * @property secretAccessKey - Secret of `accessKeyId`
 * @property forcePathStyle - Path-style URLs (`<endpoint>/<bucket>/<key>`), required by most S3-compatible servers
 * @property createBucket - Create the bucket at startup when it is missing (local development only)
 * @property presignTtl - Seconds a presigned download URL stays valid
 * @property maxUploadBytes - Largest accepted upload
 */
export type StorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  createBucket: boolean;
  presignTtl: number;
  maxUploadBytes: number;
};

/** The configuration key used to look up storage settings in the config store. */
const CONFIG_KEY = 'Storage';

/**
 * Read an optional key, falling back to a default when it is absent.
 *
 * @param key - Key under {@link CONFIG_KEY}
 * @param fallback - Value returned when the key is not configured
 * @returns The configured value or the fallback
 */
function optional<T>(key: string, fallback: T): T {
  return config.has(`${CONFIG_KEY}.${key}`) ? config.get(`${CONFIG_KEY}.${key}`) : fallback;
}

/**
 * Resolved storage configuration loaded from the application config store.
 *
 * @example
 * ```typescript
 * import { storageConfig } from '@configs';
 *
 * new S3Client({ region: storageConfig.region, endpoint: storageConfig.endpoint || undefined });
 * ```
 */
export const storageConfig: StorageConfig = {
  endpoint: optional('endpoint', ''),
  region: optional('region', 'eu-north-1'),
  bucket: optional('bucket', 'omnipotent-assets'),
  accessKeyId: optional('accessKeyId', ''),
  secretAccessKey: optional('secretAccessKey', ''),
  forcePathStyle: optional('forcePathStyle', false),
  createBucket: optional('createBucket', false),
  presignTtl: optional('presignTtl', 3600),
  maxUploadBytes: optional('maxUploadBytes', 5242880),
};
