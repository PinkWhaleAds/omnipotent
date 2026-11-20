/**
 * @module scripts/google-connect
 *
 * Command-line entry point of `pnpm google:connect`: keeps the OAuth consent of our Google Ads inviter,
 * the human admin of our manager account (MCC) who sends and withdraws the invitations Google refuses
 * to our service account, then exits (`docs/phase-10.md` § 3, `docs/runbook-acces.md` B8). Run it
 * once per environment, and again when Google refuses the refresh token (`invalid_grant`). The logic
 * lives in `src/platforms/google/google-connect.ts`.
 */
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { createInterface, Interface } from 'node:readline';
import { Writable } from 'node:stream';

import { googleAdsConfig } from '@configs/google-ads.config';
import { secretsConfig } from '@configs/secrets.config';
import { connectGoogleAds } from '@src/platforms/google/google-connect';
import { AwsSecretStore, buildSecretsClientConfig } from '@src/services/secret-store.service';

/**
 * Ask a question on the terminal without echoing the answer: an OAuth client secret.
 *
 * @param question - The question
 * @returns The answer
 */
function askHidden(question: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk: Buffer, _encoding: BufferEncoding, done: () => void): void {
      if (!muted) process.stdout.write(chunk);
      done();
    },
  });
  const reader: Interface = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise<string>((resolve): void => {
    reader.question(question, (answer: string): void => {
      reader.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

connectGoogleAds({
  secrets: new AwsSecretStore(new SecretsManagerClient(buildSecretsClientConfig(secretsConfig)), secretsConfig),
  secretName: googleAdsConfig.inviterSecret,
  print: (line: string): void => {
    process.stdout.write(`${line}\n`);
  },
  ask: askHidden,
}).then(
  (): never => process.exit(0),
  (error: unknown): never => {
    process.stderr.write(
      `Google Ads inviter consent failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exit(1);
  }
);
