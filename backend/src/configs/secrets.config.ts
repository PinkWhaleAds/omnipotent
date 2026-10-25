import config from 'config';

/**
 * Configuration interface for the secret store (AWS Secrets Manager, or the moto
 * emulator locally) holding the credentials the application needs.
 *
 * @property endpoint - Custom endpoint of an emulator; empty on AWS
 * @property region - AWS region of the secrets
 * @property prefix - Prefix of every secret name, to share an AWS account between environments
 * @property accessKeyId - Static credentials for an emulator; empty on AWS (the IAM role is used)
 * @property secretAccessKey - Secret of `accessKeyId`
 * @property cacheTtl - Milliseconds a secret read is kept in memory
 */
export type SecretsConfig = {
  endpoint: string;
  region: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  cacheTtl: number;
};

/** The configuration key used to look up secret store settings in the config store. */
const CONFIG_KEY = 'Secrets';

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
 * Resolved secret store configuration loaded from the application config store.
 *
 * @example
 * ```typescript
 * import { secretsConfig } from '@configs';
 *
 * new SecretsManagerClient({ region: secretsConfig.region });
 * ```
 */
export const secretsConfig: SecretsConfig = {
  endpoint: optional('endpoint', ''),
  region: optional('region', 'eu-north-1'),
  prefix: optional('prefix', 'omnipotent'),
  accessKeyId: optional('accessKeyId', ''),
  secretAccessKey: optional('secretAccessKey', ''),
  cacheTtl: optional('cacheTtl', 300000),
};
