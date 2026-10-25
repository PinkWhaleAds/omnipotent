const getAuthTokenMock: jest.Mock = jest.fn();
const signerConstructorMock: jest.Mock = jest.fn();
jest.mock('@aws-sdk/rds-signer', () => ({
  Signer: jest.fn().mockImplementation((options: unknown) => {
    signerConstructorMock(options);
    return { getAuthToken: getAuthTokenMock };
  }),
}));

import { DatabaseConfig } from '@configs/database.config';
import {
  createIamPasswordProvider,
  databasePassword,
  IAM_TOKEN_REUSE_MS,
  IamAuthTarget,
  signRdsToken,
} from '@src/database/iam-auth';

describe('Unit::Database::IamAuth', () => {
  const TARGET: IamAuthTarget = {
    host: 'db.abc.eu-north-1.rds.amazonaws.com',
    port: 5432,
    user: 'omnipotent_app',
    region: 'eu-north-1',
  };

  const CONFIG: DatabaseConfig = {
    host: TARGET.host,
    port: TARGET.port,
    user: TARGET.user,
    password: 'unused',
    name: 'omnipotent',
    ssl: true,
    poolSize: 10,
    logging: false,
    iamAuth: true,
    region: 'eu-north-1',
    appUser: '',
  };

  beforeEach((): void => {
    jest.clearAllMocks();
  });

  describe('signRdsToken', () => {
    it('should sign a token for the user of the instance with the default credentials', async (): Promise<void> => {
      getAuthTokenMock.mockResolvedValue('signed-token');

      await expect(signRdsToken(TARGET)).resolves.toBe('signed-token');

      expect(signerConstructorMock).toHaveBeenCalledWith({
        hostname: TARGET.host,
        port: 5432,
        username: 'omnipotent_app',
        region: 'eu-north-1',
      });
    });
  });

  describe('createIamPasswordProvider', () => {
    it('should reuse a token until it is close to expiring, then sign a new one', async (): Promise<void> => {
      let clock = 1_000;
      const sign: jest.Mock = jest.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');
      const password = createIamPasswordProvider(TARGET, sign, (): number => clock);

      await expect(password()).resolves.toBe('first');
      clock += IAM_TOKEN_REUSE_MS - 1;
      await expect(password()).resolves.toBe('first');
      clock += 1;
      await expect(password()).resolves.toBe('second');

      expect(sign).toHaveBeenCalledTimes(2);
      expect(sign).toHaveBeenCalledWith(TARGET);
    });

    it('should sign once for connections opened at the same time', async (): Promise<void> => {
      const sign: jest.Mock = jest.fn().mockResolvedValue('token');
      const password = createIamPasswordProvider(TARGET, sign);

      await expect(Promise.all([password(), password(), password()])).resolves.toEqual(['token', 'token', 'token']);

      expect(sign).toHaveBeenCalledTimes(1);
    });

    it('should sign again after a failed signature', async (): Promise<void> => {
      const sign: jest.Mock = jest.fn().mockRejectedValueOnce(new Error('no credentials')).mockResolvedValue('token');
      const password = createIamPasswordProvider(TARGET, sign);

      await expect(password()).rejects.toThrow('no credentials');
      await expect(password()).resolves.toBe('token');

      expect(sign).toHaveBeenCalledTimes(2);
    });

    it('should sign with RDS by default', async (): Promise<void> => {
      getAuthTokenMock.mockResolvedValue('rds-token');

      await expect(createIamPasswordProvider(TARGET)()).resolves.toBe('rds-token');
    });
  });

  describe('databasePassword', () => {
    it('should return the configured password without IAM authentication', (): void => {
      expect(databasePassword({ ...CONFIG, iamAuth: false, password: 's3cret' })).toBe('s3cret');
    });

    it('should return a token provider for the connection user with IAM authentication', async (): Promise<void> => {
      const sign: jest.Mock = jest.fn().mockResolvedValue('token');

      const password = databasePassword(CONFIG, sign);

      expect(password).toEqual(expect.any(Function));
      await expect((password as () => Promise<string>)()).resolves.toBe('token');
      expect(sign).toHaveBeenCalledWith(TARGET);
    });

    it('should sign with RDS by default', async (): Promise<void> => {
      getAuthTokenMock.mockResolvedValue('rds-token');

      await expect((databasePassword(CONFIG) as () => Promise<string>)()).resolves.toBe('rds-token');
    });

    it('should refuse IAM authentication without a region', (): void => {
      expect(() => databasePassword({ ...CONFIG, region: '' })).toThrow('Database.region (DB_REGION) is required');
    });
  });
});
