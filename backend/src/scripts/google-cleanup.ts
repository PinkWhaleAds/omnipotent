/**
 * @module scripts/google-cleanup
 *
 * Command-line entry point of `pnpm google:cleanup`: removes from a Google Ads account the campaigns
 * Omnipotent created there during our tests, and only those, then archives on our side the campaigns
 * they were the projection of, so that no synchronization sends them again.
 *
 * - **What is ours** is told by the name: every campaign Omnipotent creates carries the tag
 *   `[op:<12 hexadecimal characters>]` (`nameTag`, `src/platforms/google/google.mapping.ts`). A campaign
 *   without it — the client's, or multi-search's, tagged `[ms:…]` — is listed apart and never touched.
 * - **Nothing happens without a « oui »**: the script lists what it would remove and archive, then asks.
 * - **It removes**, where the synchronization only ever pauses (R5): a test campaign has no history worth
 *   keeping. Google removes its ad groups, ads and keywords with it. The conversion actions are left.
 * - **On our side**, the units of the account of each campaign concerned are deleted, and the campaign
 *   is archived — or only loses those units, when it also buys on another account.
 *
 * It reads the database and the secret store of the environment it runs in (`.env`): locally, the
 * development database and our development credentials.
 */
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { createInterface, Interface } from 'node:readline';
import { DataSource, EntityManager, In } from 'typeorm';

import { googleAdsConfig } from '@configs/google-ads.config';
import { secretsConfig } from '@configs/secrets.config';
import { createDataSource } from '@src/database/data-source';
import { AdAccountEntity, CampaignEntity, PlatformUnitEntity } from '@src/database/entities';
import { createGoogleAdsClient, formatCustomerId } from '@src/platforms/google/google.adapter';
import { GoogleAdsClient } from '@src/platforms/google/google.client';
import { GoogleAdsRow, GoogleMutateOperation } from '@src/platforms/google/google.types';
import { googleAdsSetup } from '@src/platforms/registry';
import { PlatformCallJournal } from '@src/services/platform-call.service';
import { AwsSecretStore, buildSecretsClientConfig } from '@src/services/secret-store.service';

/** The tag of the name of every campaign Omnipotent creates at Google. */
const OUR_TAG = /\[op:[0-9a-f]{12}\]/;

/** A campaign of the account, as Google lists it. */
type GoogleCampaignRow = { resourceName: string; id: string; name: string; status: string };

/**
 * Write a line on the terminal.
 *
 * @param line - The line
 * @returns Nothing
 */
function say(line = ''): void {
  process.stdout.write(`${line}\n`);
}

/**
 * Ask a question on the terminal, opened for that question only: a terminal left open would read the
 * end of a piped input as closed before the question comes.
 *
 * @param question - The question
 * @returns The answer, trimmed
 */
function ask(question: string): Promise<string> {
  const reader: Interface = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve): void => {
    reader.question(question, (answer: string): void => {
      reader.close();
      resolve(answer.trim());
    });
  });
}

/**
 * The Google Ads account to clean: the only one of the database, or the one chosen.
 *
 * @param dataSource - The database
 * @returns The account
 * @throws Error when the database has no Google Ads account
 */
async function chooseAccount(dataSource: DataSource): Promise<AdAccountEntity> {
  const accounts: AdAccountEntity[] = await dataSource
    .getRepository(AdAccountEntity)
    .find({ where: { platform: 'google_ads' }, order: { createdAt: 'ASC' } });
  if (accounts.length === 0) throw new Error('No Google Ads account in this database');
  if (accounts.length === 1) return accounts[0];
  accounts.forEach((account: AdAccountEntity, index: number): void => {
    say(
      `  ${index + 1}. ${account.name ?? '(sans nom)'} — ${formatCustomerId(account.externalId)} (${account.status})`
    );
  });
  const answer = Number(await ask('Quel compte ? '));
  const account: AdAccountEntity | undefined = accounts[answer - 1];
  if (!account) throw new Error('No such account');
  return account;
}

/**
 * Every campaign of the account Google still holds, removed ones left out.
 *
 * @param client - The API
 * @param account - The account
 * @returns The campaigns
 */
async function campaignsOf(client: GoogleAdsClient, account: AdAccountEntity): Promise<GoogleCampaignRow[]> {
  const rows: GoogleAdsRow[] = await client.search(
    account.id,
    account.externalId,
    "SELECT campaign.resource_name, campaign.id, campaign.name, campaign.status FROM campaign WHERE campaign.status != 'REMOVED'"
  );
  return rows.map((row: GoogleAdsRow): GoogleCampaignRow => ({
    resourceName: row.campaign?.resourceName as string,
    id: row.campaign?.id as string,
    name: row.campaign?.name ?? '',
    status: row.campaign?.status ?? '',
  }));
}

/**
 * Remove the campaigns at Google, in one atomic change, then archive ours.
 *
 * @param dataSource - The database
 * @param client - The API
 * @param account - The account
 * @param ours - The campaigns to remove
 * @param units - The units of the account, by the Google campaigns they hold
 * @returns A promise that resolves once done
 */
async function clean(
  dataSource: DataSource,
  client: GoogleAdsClient,
  account: AdAccountEntity,
  ours: readonly GoogleCampaignRow[],
  units: ReadonlyMap<string, PlatformUnitEntity>
): Promise<void> {
  const operations: GoogleMutateOperation[] = ours.map((campaign: GoogleCampaignRow): GoogleMutateOperation => ({
    campaignOperation: { remove: campaign.resourceName },
  }));
  await client.mutate(account.id, account.externalId, operations);
  say(`${operations.length} campagne(s) supprimée(s) chez Google.`);

  const campaignIds = new Set<string>(
    ours.flatMap((campaign: GoogleCampaignRow): string[] => {
      const unit: PlatformUnitEntity | undefined = units.get(campaign.resourceName);
      return unit ? [unit.campaignId] : [];
    })
  );
  await dataSource.transaction(async (manager: EntityManager): Promise<void> => {
    for (const campaignId of campaignIds) {
      await manager.delete(PlatformUnitEntity, { campaignId, adAccountId: account.id });
      const elsewhere: number = await manager.count(PlatformUnitEntity, { where: { campaignId } });
      const campaign: CampaignEntity | null = await manager.findOne(CampaignEntity, {
        where: { id: campaignId },
        withDeleted: true,
      });
      if (elsewhere === 0) {
        await manager.update(CampaignEntity, { id: campaignId }, { status: 'archived' });
        say(`Archivée chez Omnipotent : ${campaign?.name ?? campaignId}.`);
      } else {
        say(`${campaign?.name ?? campaignId} achète aussi ailleurs : seules ses unités de ce compte sont ôtées.`);
      }
    }
  });
}

/**
 * List, ask, clean.
 *
 * @returns A promise that resolves once done, or once the user said no
 */
async function main(): Promise<void> {
  const dataSource: DataSource = createDataSource();
  await dataSource.initialize();
  try {
    const secrets = new AwsSecretStore(
      new SecretsManagerClient(buildSecretsClientConfig(secretsConfig)),
      secretsConfig
    );
    const client: GoogleAdsClient = createGoogleAdsClient(
      googleAdsSetup(secrets, googleAdsConfig),
      new PlatformCallJournal(dataSource)
    );
    const account: AdAccountEntity = await chooseAccount(dataSource);
    say(`\nCompte ${account.name ?? ''} ${formatCustomerId(account.externalId)}`);

    const campaigns: GoogleCampaignRow[] = await campaignsOf(client, account);
    const ours: GoogleCampaignRow[] = campaigns.filter((campaign: GoogleCampaignRow): boolean =>
      OUR_TAG.test(campaign.name)
    );
    const theirs: GoogleCampaignRow[] = campaigns.filter(
      (campaign: GoogleCampaignRow): boolean => !ours.includes(campaign)
    );
    const units = new Map<string, PlatformUnitEntity>();
    for (const unit of await dataSource.getRepository(PlatformUnitEntity).findBy({ adAccountId: account.id })) {
      for (const name of Object.values(unit.refs)) if (name.includes('/campaigns/')) units.set(name, unit);
    }
    const ourCampaigns: CampaignEntity[] = await dataSource.getRepository(CampaignEntity).find({
      where: { id: In([...new Set([...units.values()].map((unit: PlatformUnitEntity): string => unit.campaignId))]) },
      withDeleted: true,
    });

    say(`\nLaissées telles quelles, sans le tag d'Omnipotent : ${theirs.length}`);
    for (const campaign of theirs) say(`  - ${campaign.id} ${campaign.status} « ${campaign.name} »`);
    say(`\nCréées par Omnipotent, à supprimer : ${ours.length}`);
    for (const campaign of ours) {
      const unit: PlatformUnitEntity | undefined = units.get(campaign.resourceName);
      const mine: CampaignEntity | undefined = ourCampaigns.find(
        (one: CampaignEntity): boolean => one.id === unit?.campaignId
      );
      say(
        `  - ${campaign.id} ${campaign.status} « ${campaign.name} »` +
          (mine ? ` — campagne Omnipotent « ${mine.name} » (${mine.status})` : ' — inconnue de cette base')
      );
    }
    if (ours.length === 0) {
      say('\nRien à supprimer.');
      return;
    }

    const answer: string = await ask(
      `\nSupprimer ces ${ours.length} campagne(s) chez Google, et archiver chez Omnipotent celles qu'elles projettent ? Tape « oui » : `
    );
    if (answer !== 'oui') {
      say('Rien n’a été touché.');
      return;
    }
    await clean(dataSource, client, account, ours, units);
  } finally {
    // The journal writes in the background: give its last inserts a moment.
    await new Promise((resolve: (value: unknown) => void): void => {
      setTimeout(resolve, 500);
    });
    await dataSource.destroy();
  }
}

main().then(
  (): never => process.exit(0),
  (error: unknown): never => {
    process.stderr.write(`Google Ads cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
);
