/**
 * @module database/iam-auth
 *
 * Passwords of the PostgreSQL connections when the application signs in with RDS IAM
 * authentication (`Database.iamAuth`): a short-lived token signed with the task's AWS role
 * instead of a stored password. node-postgres calls the password function for every new
 * connection, so the token only has to be valid when a connection opens; open connections
 * outlive it.
 */
import { Signer } from '@aws-sdk/rds-signer';

import { DatabaseConfig } from '@configs/database.config';

/** RDS accepts a token for 15 minutes: one is reused for 10, so a connection never gets an expiring one. */
export const IAM_TOKEN_REUSE_MS: number = 10 * 60 * 1000;

/**
 * The database user a token signs in.
 *
 * @property host - Host name of the instance (the one the connection uses)
 * @property port - Its port
 * @property user - The database role, granted `rds_iam`
 * @property region - AWS region of the instance
 */
export type IamAuthTarget = { host: string; port: number; user: string; region: string };

/** Signs one authentication token. */
export type IamTokenSigner = (target: IamAuthTarget) => Promise<string>;

/**
 * Sign a token with the default AWS credentials (the ECS task role on AWS). Signing is local: no
 * network call besides fetching the role's credentials, which the SDK caches.
 *
 * @param target - The user to sign in
 * @returns The token, used as the password
 */
export async function signRdsToken(target: IamAuthTarget): Promise<string> {
  const signer: Signer = new Signer({
    hostname: target.host,
    port: target.port,
    username: target.user,
    region: target.region,
  });
  return signer.getAuthToken();
}

/**
 * A password function for node-postgres that signs a token, reuses it for
 * {@link IAM_TOKEN_REUSE_MS}, and signs once for concurrent connections.
 *
 * @param target - The user to sign in
 * @param sign - Signs a token (RDS by default; injectable for tests)
 * @param now - The clock, in ms
 * @returns The function to pass as `password`
 */
export function createIamPasswordProvider(
  target: IamAuthTarget,
  sign: IamTokenSigner = signRdsToken,
  now: () => number = Date.now
): () => Promise<string> {
  let cached: { token: string; expiresAt: number } | null = null;
  let pending: Promise<string> | null = null;
  return async (): Promise<string> => {
    if (cached !== null && now() < cached.expiresAt) return cached.token;
    pending ??= sign(target)
      .then((token: string): string => {
        cached = { token, expiresAt: now() + IAM_TOKEN_REUSE_MS };
        return token;
      })
      .finally((): void => {
        pending = null;
      });
    return pending;
  };
}

/**
 * The password of the connections: the configured one, or a token provider with IAM authentication.
 *
 * @param config - Connection settings
 * @param sign - Signs a token (RDS by default; injectable for tests)
 * @returns What to pass as `password` to TypeORM and pg-boss
 * @throws Error when IAM authentication is on without a region
 */
export function databasePassword(
  config: DatabaseConfig,
  sign: IamTokenSigner = signRdsToken
): string | (() => Promise<string>) {
  if (!config.iamAuth) return config.password;
  if (!config.region) throw new Error('Database.region (DB_REGION) is required with IAM authentication');
  return createIamPasswordProvider(
    { host: config.host, port: config.port, user: config.user, region: config.region },
    sign
  );
}
