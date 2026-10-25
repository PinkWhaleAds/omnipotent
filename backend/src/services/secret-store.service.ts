import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
  SecretsManagerClientConfig,
} from '@aws-sdk/client-secrets-manager';
import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { SecretsConfig, secretsConfig } from '@configs/secrets.config';
import { httpError, TtlCache } from '@utils';

/**
 * Where credentials live. Postgres only keeps their name.
 */
export interface SecretStore {
  /**
   * Read a secret.
   *
   * @param name - Name relative to the configured prefix
   * @param options - How to read it
   * @param options.fresh - Read the store itself, never a value kept in memory (a secret another
   *   process rewrites, such as rotating OAuth tokens); the value read is kept for later reads
   * @returns Its value
   * @throws Error with status 500 when it does not exist
   */
  get(name: string, options?: { fresh?: boolean }): Promise<string>;

  /**
   * Create or replace a secret.
   *
   * @param name - Name relative to the configured prefix
   * @param value - Its value
   * @returns A promise that resolves once stored
   */
  put(name: string, value: string): Promise<void>;

  /**
   * Delete a secret; deleting a missing one is not an error.
   *
   * @param name - Name relative to the configured prefix
   * @returns A promise that resolves once deleted
   */
  delete(name: string): Promise<void>;
}

/**
 * Build the Secrets Manager client options from the configuration.
 *
 * @param config - Secret store settings
 * @returns Client options: an emulator endpoint and static keys when configured, the IAM role otherwise
 */
export function buildSecretsClientConfig(config: SecretsConfig): SecretsManagerClientConfig {
  return {
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    ...(config.accessKeyId
      ? { credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }
      : {}),
  };
}

/**
 * Secret store on AWS Secrets Manager (moto locally), with a short in-memory cache
 * so that a caller does not read the same key at every call (a fresh read skips it).
 */
export class AwsSecretStore implements SecretStore {
  /** Recently read values, by full name. */
  private readonly cache: TtlCache<string>;

  /**
   * @param client - Secrets Manager client
   * @param config - Prefix and cache settings
   */
  constructor(
    private readonly client: SecretsManagerClient,
    private readonly config: SecretsConfig
  ) {
    this.cache = new TtlCache<string>(config.cacheTtl);
  }

  /** @inheritdoc */
  public async get(name: string, options: { fresh?: boolean } = {}): Promise<string> {
    const id: string = this.fullName(name);
    const cached: string | undefined = options.fresh ? undefined : this.cache.get(id);
    if (cached !== undefined) return cached;
    try {
      const output = await this.client.send(new GetSecretValueCommand({ SecretId: id }));
      const value: string = output.SecretString ?? '';
      this.cache.set(id, value);
      return value;
    } catch (error: unknown) {
      // The name stays out of the values: they reach the caller even on a 5xx.
      if (error instanceof ResourceNotFoundException) {
        throw httpError(500, `Secret ${id} is missing`, { code: 'secret_missing', cause: error });
      }
      throw error;
    }
  }

  /** @inheritdoc */
  public async put(name: string, value: string): Promise<void> {
    const id: string = this.fullName(name);
    try {
      await this.client.send(new PutSecretValueCommand({ SecretId: id, SecretString: value }));
    } catch (error: unknown) {
      if (!(error instanceof ResourceNotFoundException)) throw error;
      await this.client.send(new CreateSecretCommand({ Name: id, SecretString: value }));
    }
    this.cache.set(id, value);
  }

  /** @inheritdoc */
  public async delete(name: string): Promise<void> {
    const id: string = this.fullName(name);
    this.cache.delete(id);
    try {
      await this.client.send(new DeleteSecretCommand({ SecretId: id, ForceDeleteWithoutRecovery: true }));
    } catch (error: unknown) {
      if (!(error instanceof ResourceNotFoundException)) throw error;
    }
  }

  /**
   * The name of a secret in Secrets Manager.
   *
   * @param name - Name relative to the prefix
   * @returns `<prefix>/<name>`
   */
  private fullName(name: string): string {
    return `${this.config.prefix}/${name}`;
  }
}

/**
 * Fastify plugin that decorates the instance with the {@link SecretStore}.
 *
 * @param fastify - The Fastify instance to decorate
 */
async function secretStorePlugin(fastify: FastifyInstance): Promise<void> {
  const store: SecretStore = new AwsSecretStore(
    new SecretsManagerClient(buildSecretsClientConfig(secretsConfig)),
    secretsConfig
  );
  fastify.decorate('secretStore', store);
}

export default fastifyPlugin(secretStorePlugin, {
  name: 'SecretStorePlugin',
});
