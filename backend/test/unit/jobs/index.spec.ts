import { FastifyInstance } from 'fastify';

import {
  ACCOUNT_LINKS_JOB,
  CAMPAIGN_END_JOB,
  JOB_DEFINITIONS,
  PACING_REFRESH_JOB,
  REVIEW_POLL_JOB,
  SYNC_CAMPAIGN_JOB,
  SYNC_SWEEP_JOB,
} from '@src/jobs';
import { JobDefinition } from '@src/types/job.types';

/** The campaign a job names. */
const CAMPAIGN_ID = 'f1000000-0000-4000-8000-000000000001';

describe('Unit::Jobs', () => {
  let sync: Record<string, jest.Mock>;
  let accounts: Record<string, jest.Mock>;
  let reviews: Record<string, jest.Mock>;
  let fastify: FastifyInstance;

  beforeEach((): void => {
    jest.clearAllMocks();
    sync = {
      syncCampaign: jest.fn().mockResolvedValue(undefined),
      sweep: jest.fn().mockResolvedValue(undefined),
      refreshPacing: jest.fn().mockResolvedValue(undefined),
      endCampaigns: jest.fn().mockResolvedValue(undefined),
    };
    accounts = { checkLinks: jest.fn().mockResolvedValue(undefined) };
    reviews = { poll: jest.fn().mockResolvedValue(undefined) };
    fastify = { syncService: sync, adAccountService: accounts, reviewService: reviews } as unknown as FastifyInstance;
  });

  it('should declare every job exactly once, under a queue name a process can create', (): void => {
    const names: string[] = JOB_DEFINITIONS.map((job: JobDefinition): string => job.name);

    expect(names).toEqual([
      'sync.campaign',
      'sync.sweep',
      'pacing.refresh',
      'campaign.end',
      'account.links',
      'review.poll',
    ]);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[\w.\-/]+$/);
  });

  describe('sync.campaign', () => {
    it('should apply the campaign it names', async (): Promise<void> => {
      await (SYNC_CAMPAIGN_JOB.createHandler(fastify) as (data: { campaignId: string }) => Promise<void>)({
        campaignId: CAMPAIGN_ID,
      });

      expect(sync.syncCampaign).toHaveBeenCalledWith(CAMPAIGN_ID);
    });

    it('should be retried a few times, and never run for ever', (): void => {
      expect(SYNC_CAMPAIGN_JOB.policy).toMatchObject({ retryLimit: 2, retryBackoff: true, expireInSeconds: 900 });
      // On demand, so no schedule: a campaign nobody touched is never loaded (D34 rule 4).
      expect(SYNC_CAMPAIGN_JOB.cron).toBeUndefined();
    });
  });

  describe('sync.sweep', () => {
    it('should sweep the backlog every minute, one pass at a time', async (): Promise<void> => {
      expect(SYNC_SWEEP_JOB.cron).toBe('* * * * *');
      // Exclusive: a pass that runs long must not have a second one piling up behind it.
      expect(SYNC_SWEEP_JOB.policy).toMatchObject({ policy: 'exclusive', retryLimit: 0 });

      await (SYNC_SWEEP_JOB.createHandler(fastify) as () => Promise<void>)();

      expect(sync.sweep).toHaveBeenCalledTimes(1);
    });
  });

  describe('pacing.refresh', () => {
    it('should look every minute for the campaigns whose own midnight has passed', async (): Promise<void> => {
      expect(PACING_REFRESH_JOB.cron).toBe('* * * * *');
      expect(PACING_REFRESH_JOB.policy).toMatchObject({ policy: 'exclusive' });

      await (PACING_REFRESH_JOB.createHandler(fastify) as () => Promise<void>)();

      expect(sync.refreshPacing).toHaveBeenCalledTimes(1);
    });
  });

  describe('campaign.end', () => {
    it('should end the campaigns past their last day, every five minutes', async (): Promise<void> => {
      expect(CAMPAIGN_END_JOB.cron).toBe('*/5 * * * *');

      await (CAMPAIGN_END_JOB.createHandler(fastify) as () => Promise<void>)();

      expect(sync.endCampaigns).toHaveBeenCalledTimes(1);
    });
  });

  describe('account.links', () => {
    it('should follow the links of the accounts every fifteen minutes, one pass at a time', async (): Promise<void> => {
      expect(ACCOUNT_LINKS_JOB.cron).toBe('*/15 * * * *');
      expect(ACCOUNT_LINKS_JOB.policy).toMatchObject({ policy: 'exclusive', retryLimit: 0 });

      await (ACCOUNT_LINKS_JOB.createHandler(fastify) as () => Promise<void>)();

      expect(accounts.checkLinks).toHaveBeenCalledTimes(1);
    });
  });

  describe('review.poll', () => {
    it('should read the verdicts of the ads every ten minutes, one pass at a time', async (): Promise<void> => {
      expect(REVIEW_POLL_JOB.cron).toBe('*/10 * * * *');
      // Exclusive and ended before the next one is due: a pass never piles up behind another.
      expect(REVIEW_POLL_JOB.policy).toMatchObject({ policy: 'exclusive', retryLimit: 0, expireInSeconds: 540 });

      await (REVIEW_POLL_JOB.createHandler(fastify) as () => Promise<void>)();

      expect(reviews.poll).toHaveBeenCalledTimes(1);
    });
  });
});
