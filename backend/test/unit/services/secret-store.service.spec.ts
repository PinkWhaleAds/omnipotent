import type { SecretsConfig } from '@configs/secrets.config';
const SECRETS_CONFIG_MOCK: SecretsConfig = {
  endpoint: 'http://localhost:9020',
  region: 'eu-west-3',
  prefix: 'omnipotent-local',
  accessKeyId: 'local-access-key',
  secretAccessKey: 'local-secret-key',
  cacheTtl: 300000,
};
jest.mock('@configs/secrets.config', () => ({ secretsConfig: SECRETS_CONFIG_MOCK }));

import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
  SecretsManagerClientConfig,
} from '@aws-sdk/client-secrets-manager';
import Fastify, { FastifyInstance } from 'fastify';

import SecretStorePlugin, { AwsSecretStore, buildSecretsClientConfig } from '@src/services/secret-store.service';

/** Jest mock standing in for the Secrets Manager client: only `send` is used. */
type SecretsClientMock = { send: jest.Mock };

/** Configuration of the unit tests: AWS-like, no endpoint nor keys. */
const AWS_CONFIG: SecretsConfig = {
  endpoint: '',
  region: 'eu-west-3',
  prefix: 'prod',
  accessKeyId: '',
  secretAccessKey: '',
  cacheTtl: 300000,
};

/** Name of the secret in the tests, relative to the prefix. */
const NAME = 'ad-accounts/c0000000-0000-4000-8000-000000000001';

/** Full name of {@link NAME} under the prefix of {@link AWS_CONFIG}. */
const SECRET_ID = `prod/${NAME}`;

/**
 * Build the error Secrets Manager answers for a missing secret.
 *
 * @returns The error
 */
function notFound(): ResourceNotFoundException {
  return new ResourceNotFoundException({ message: 'Secrets Manager can’t find the specified secret.', $metadata: {} });
}

describe('Unit::Services::SecretStore', () => {
  let client: SecretsClientMock;
  let store: AwsSecretStore;

  beforeEach((): void => {
    jest.clearAllMocks();
    client = { send: jest.fn().mockResolvedValue({ SecretString: 'sk-live-123' }) };
    store = new AwsSecretStore(client as unknown as SecretsManagerClient, AWS_CONFIG);
  });

  /**
   * The command of a call to the client.
   *
   * @param index - The call, in order
   * @returns The command sent
   */
  function sent(index: number): unknown {
    return client.send.mock.calls[index][0];
  }

  describe('buildSecretsClientConfig', () => {
    it('should leave the endpoint and the credentials to the SDK on AWS', (): void => {
      const options: SecretsManagerClientConfig = buildSecretsClientConfig(AWS_CONFIG);

      expect(options).toEqual({ region: 'eu-west-3' });
      expect(options).not.toHaveProperty('endpoint');
      expect(options).not.toHaveProperty('credentials');
    });

    it('should point at a local emulator with static keys', (): void => {
      expect(buildSecretsClientConfig(SECRETS_CONFIG_MOCK)).toEqual({
        region: 'eu-west-3',
        endpoint: 'http://localhost:9020',
        credentials: { accessKeyId: 'local-access-key', secretAccessKey: 'local-secret-key' },
      });
    });

    it('should set the endpoint alone when there are no keys', (): void => {
      expect(buildSecretsClientConfig({ ...AWS_CONFIG, endpoint: 'https://secrets.example.test' })).toEqual({
        region: 'eu-west-3',
        endpoint: 'https://secrets.example.test',
      });
    });

    it('should set the credentials alone when there is no endpoint', (): void => {
      expect(buildSecretsClientConfig({ ...AWS_CONFIG, accessKeyId: 'key', secretAccessKey: 'secret' })).toEqual({
        region: 'eu-west-3',
        credentials: { accessKeyId: 'key', secretAccessKey: 'secret' },
      });
    });
  });

  describe('get', () => {
    it('should read the secret under the prefix and return its value', async (): Promise<void> => {
      await expect(store.get(NAME)).resolves.toBe('sk-live-123');

      expect(client.send).toHaveBeenCalledTimes(1);
      expect(sent(0)).toBeInstanceOf(GetSecretValueCommand);
      expect((sent(0) as GetSecretValueCommand).input).toEqual({ SecretId: SECRET_ID });
    });

    it('should return an empty string for a secret without string value', async (): Promise<void> => {
      client.send.mockResolvedValue({ SecretBinary: new Uint8Array([1, 2, 3]) });

      await expect(store.get(NAME)).resolves.toBe('');
      await expect(store.get(NAME)).resolves.toBe('');
      expect(client.send).toHaveBeenCalledTimes(1);
    });

    it('should serve a second read from the cache', async (): Promise<void> => {
      await store.get(NAME);
      client.send.mockResolvedValue({ SecretString: 'sk-rotated' });

      await expect(store.get(NAME)).resolves.toBe('sk-live-123');
      expect(client.send).toHaveBeenCalledTimes(1);
    });

    it('should read the store itself on a fresh read, and keep what it read', async (): Promise<void> => {
      await store.get(NAME);
      client.send.mockResolvedValue({ SecretString: 'sk-rotated' });

      await expect(store.get(NAME, { fresh: true })).resolves.toBe('sk-rotated');
      await expect(store.get(NAME)).resolves.toBe('sk-rotated');
      await expect(store.get(NAME, {})).resolves.toBe('sk-rotated');
      expect(client.send).toHaveBeenCalledTimes(2);
    });

    it('should cache each secret on its own', async (): Promise<void> => {
      await store.get(NAME);
      client.send.mockResolvedValue({ SecretString: 'sk-other' });

      await expect(store.get('ad-accounts/other')).resolves.toBe('sk-other');
      expect(client.send).toHaveBeenCalledTimes(2);
      expect((sent(1) as GetSecretValueCommand).input).toEqual({ SecretId: 'prod/ad-accounts/other' });
    });

    it('should answer 500 for a missing secret, naming it', async (): Promise<void> => {
      client.send.mockRejectedValue(notFound());

      await expect(store.get(NAME)).rejects.toMatchObject({
        statusCode: 500,
        message: `Secret ${SECRET_ID} is missing`,
        errorCode: 'secret_missing',
        errorParams: {},
      });
    });

    it('should rethrow any other failure as is, and cache nothing', async (): Promise<void> => {
      const failure: Error = new Error('connect ECONNREFUSED');
      client.send.mockRejectedValueOnce(failure);

      await expect(store.get(NAME)).rejects.toBe(failure);
      await expect(store.get(NAME)).resolves.toBe('sk-live-123');
      expect(client.send).toHaveBeenCalledTimes(2);
    });

    describe('cache expiry', () => {
      let now: jest.SpyInstance<number, []>;

      beforeEach((): void => {
        now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
        // The cache reads `Date.now` when built: build the store once the clock is mocked.
        store = new AwsSecretStore(client as unknown as SecretsManagerClient, AWS_CONFIG);
      });

      afterEach((): void => {
        now.mockRestore();
      });

      it('should keep a value cacheTtl milliseconds, then read it again', async (): Promise<void> => {
        await store.get(NAME);
        client.send.mockResolvedValue({ SecretString: 'sk-rotated' });

        now.mockReturnValue(1_000_000 + AWS_CONFIG.cacheTtl - 1);
        await expect(store.get(NAME)).resolves.toBe('sk-live-123');
        expect(client.send).toHaveBeenCalledTimes(1);

        now.mockReturnValue(1_000_000 + AWS_CONFIG.cacheTtl);
        await expect(store.get(NAME)).resolves.toBe('sk-rotated');
        expect(client.send).toHaveBeenCalledTimes(2);
        expect((sent(1) as GetSecretValueCommand).input).toEqual({ SecretId: SECRET_ID });
      });
    });
  });

  describe('put', () => {
    it('should replace the value of an existing secret, then serve it from the cache', async (): Promise<void> => {
      client.send.mockResolvedValue({});

      await expect(store.put(NAME, 'sk-new')).resolves.toBeUndefined();

      expect(client.send).toHaveBeenCalledTimes(1);
      expect(sent(0)).toBeInstanceOf(PutSecretValueCommand);
      expect((sent(0) as PutSecretValueCommand).input).toEqual({ SecretId: SECRET_ID, SecretString: 'sk-new' });
      await expect(store.get(NAME)).resolves.toBe('sk-new');
      expect(client.send).toHaveBeenCalledTimes(1);
    });

    it('should replace a value cached by an earlier read', async (): Promise<void> => {
      await store.get(NAME);
      client.send.mockResolvedValue({});

      await store.put(NAME, 'sk-new');

      await expect(store.get(NAME)).resolves.toBe('sk-new');
      expect(client.send).toHaveBeenCalledTimes(2);
    });

    it('should create a secret that does not exist yet, then serve it from the cache', async (): Promise<void> => {
      client.send.mockRejectedValueOnce(notFound()).mockResolvedValueOnce({});

      await expect(store.put(NAME, 'sk-new')).resolves.toBeUndefined();

      expect(client.send).toHaveBeenCalledTimes(2);
      expect(sent(0)).toBeInstanceOf(PutSecretValueCommand);
      expect(sent(1)).toBeInstanceOf(CreateSecretCommand);
      expect((sent(1) as CreateSecretCommand).input).toEqual({ Name: SECRET_ID, SecretString: 'sk-new' });
      await expect(store.get(NAME)).resolves.toBe('sk-new');
      expect(client.send).toHaveBeenCalledTimes(2);
    });

    it('should rethrow any other failure without creating nor caching', async (): Promise<void> => {
      const failure: Error = new Error('AccessDeniedException');
      client.send.mockRejectedValueOnce(failure);

      await expect(store.put(NAME, 'sk-new')).rejects.toBe(failure);

      expect(client.send).toHaveBeenCalledTimes(1);
      await expect(store.get(NAME)).resolves.toBe('sk-live-123');
      expect(client.send).toHaveBeenCalledTimes(2);
      expect(sent(1)).toBeInstanceOf(GetSecretValueCommand);
    });

    it('should propagate a failed creation without caching', async (): Promise<void> => {
      const failure: Error = new Error('LimitExceededException');
      client.send.mockRejectedValueOnce(notFound()).mockRejectedValueOnce(failure);

      await expect(store.put(NAME, 'sk-new')).rejects.toBe(failure);

      await expect(store.get(NAME)).resolves.toBe('sk-live-123');
      expect(client.send).toHaveBeenCalledTimes(3);
    });
  });

  describe('delete', () => {
    it('should delete the secret at once, without recovery window', async (): Promise<void> => {
      client.send.mockResolvedValue({});

      await expect(store.delete(NAME)).resolves.toBeUndefined();

      expect(client.send).toHaveBeenCalledTimes(1);
      expect(sent(0)).toBeInstanceOf(DeleteSecretCommand);
      expect((sent(0) as DeleteSecretCommand).input).toEqual({ SecretId: SECRET_ID, ForceDeleteWithoutRecovery: true });
    });

    it('should forget the cached value, so the next read asks Secrets Manager', async (): Promise<void> => {
      client.send.mockResolvedValue({});
      await store.put(NAME, 'sk-new');

      await store.delete(NAME);

      client.send.mockRejectedValue(notFound());
      await expect(store.get(NAME)).rejects.toMatchObject({ statusCode: 500 });
      expect(client.send).toHaveBeenCalledTimes(3);
      expect(sent(2)).toBeInstanceOf(GetSecretValueCommand);
    });

    it('should ignore a secret that is already gone', async (): Promise<void> => {
      client.send.mockRejectedValue(notFound());

      await expect(store.delete(NAME)).resolves.toBeUndefined();
    });

    it('should rethrow any other failure as is', async (): Promise<void> => {
      const failure: Error = new Error('connect ECONNREFUSED');
      client.send.mockRejectedValue(failure);

      await expect(store.delete(NAME)).rejects.toBe(failure);
    });
  });

  describe('SecretStorePlugin', () => {
    let send: jest.SpyInstance;

    beforeEach((): void => {
      send = jest
        .spyOn(SecretsManagerClient.prototype, 'send')
        .mockImplementation(async (): Promise<object> => ({ SecretString: 'sk-from-moto' }));
    });

    afterEach((): void => {
      send.mockRestore();
    });

    it('should decorate the instance with an AwsSecretStore on the configured client', async (): Promise<void> => {
      const app: FastifyInstance = Fastify();
      await app.register(SecretStorePlugin);
      await app.ready();

      expect(app.secretStore).toBeInstanceOf(AwsSecretStore);
      await expect(app.secretStore.get('ad-accounts/abc')).resolves.toBe('sk-from-moto');
      expect(send).toHaveBeenCalledTimes(1);
      const command: unknown = send.mock.calls[0][0];
      expect(command).toBeInstanceOf(GetSecretValueCommand);
      expect((command as GetSecretValueCommand).input).toEqual({ SecretId: 'omnipotent-local/ad-accounts/abc' });

      const usedClient: SecretsManagerClient = send.mock.contexts[0] as SecretsManagerClient;
      expect(usedClient).toBeInstanceOf(SecretsManagerClient);
      await expect(usedClient.config.region()).resolves.toBe('eu-west-3');
      await expect(usedClient.config.credentials()).resolves.toMatchObject({
        accessKeyId: 'local-access-key',
        secretAccessKey: 'local-secret-key',
      });

      await app.close();
    });
  });
});
