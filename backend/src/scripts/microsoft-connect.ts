/**
 * @module scripts/microsoft-connect
 *
 * Command-line entry point of `pnpm microsoft:connect`: keeps the OAuth consent of our Microsoft
 * Advertising service user, the dedicated account that is Super Admin of our manager account, then
 * exits (`docs/phase-11.md` § 3, `docs/runbook-acces.md` C5). Run it once per environment, and again
 * when Microsoft refuses the refresh token (`invalid_grant`). The logic lives in
 * `src/platforms/microsoft/microsoft-connect.ts`.
 */
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

import { microsoftAdsConfig } from '@configs/microsoft-ads.config';
import { secretsConfig } from '@configs/secrets.config';
import { connectMicrosoftAds } from '@src/platforms/microsoft/microsoft-connect';
import { AwsSecretStore, buildSecretsClientConfig } from '@src/services/secret-store.service';

connectMicrosoftAds({
  config: microsoftAdsConfig,
  secrets: new AwsSecretStore(new SecretsManagerClient(buildSecretsClientConfig(secretsConfig)), secretsConfig),
  print: (line: string): void => {
    process.stdout.write(`${line}\n`);
  },
}).then(
  (): never => process.exit(0),
  (error: unknown): never => {
    process.stderr.write(
      `Microsoft Advertising consent failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exit(1);
  }
);
