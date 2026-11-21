import { FastifyInstance } from 'fastify';

import {
  ACCOUNT_LINKS_JOB,
  CAMPAIGN_END_JOB,
  CONVERSION_SETUP_JOB,
  CONVERSION_SWEEP_JOB,
  GEO_IMPORT_JOB,
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
  let geoImport: Record<string, jest.Mock>;
  let tracking: Record<string, jest.Mock>;
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
    geoImport = {
      importGoogle: jest.fn().mockResolvedValue(null),
      queueWhenEmpty: jest.fn().mockResolvedValue(true),
    };
    tracking = { setup: jest.fn().mockResolvedValue(undefined), sweep: jest.fn().mockResolvedValue(undefined) };
    fastify = {
      trackingService: tracking,
      syncService: sync,
      adAccountService: accounts,
      reviewService: reviews,
      geoImportService: geoImport,
    } as unknown as FastifyInstance;
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
      'geo.import',
      'conversion.setup',
      'conversion.sweep',
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

  describe('geo.import', () => {
    it("should import Google's catalog of places the 1st of every month, one import at a time", async (): Promise<void> => {
      expect(GEO_IMPORT_JOB.cron).toBe('0 3 1 * *');
      expect(GEO_IMPORT_JOB.policy).toMatchObject({ policy: 'exclusive', retryLimit: 2, retryDelay: 900 });

      // pg-boss gives `null` to a scheduled job.
      await GEO_IMPORT_JOB.createHandler(fastify)(null, { id: 'job-1', retryCount: 0 });

      expect(geoImport.importGoogle).toHaveBeenCalledWith({ whenEmpty: false });
    });

    it('should import only into an empty referential the job queued at a worker start', async (): Promise<void> => {
      await GEO_IMPORT_JOB.createHandler(fastify)({ whenEmpty: true }, { id: 'job-1', retryCount: 0 });

      expect(geoImport.importGoogle).toHaveBeenCalledWith({ whenEmpty: true });
    });

    it('should queue that job at each worker start', async (): Promise<void> => {
      await GEO_IMPORT_JOB.onWorkerStart?.(fastify);

      expect(geoImport.queueWhenEmpty).toHaveBeenCalledTimes(1);
    });
  });

  describe('conversion.setup and conversion.sweep', () => {
    it('should set the tracking of one Advertiser up, retried twice', async (): Promise<void> => {
      expect(CONVERSION_SETUP_JOB.cron).toBeUndefined();
      expect(CONVERSION_SETUP_JOB.policy).toMatchObject({ retryLimit: 2, retryDelay: 60, expireInSeconds: 900 });

      await CONVERSION_SETUP_JOB.createHandler(fastify)(
        { advertiserId: 'd0000000-0000-4000-8000-000000000001' },
        {
          id: 'job-1',
          retryCount: 0,
        }
      );

      expect(tracking.setup).toHaveBeenCalledWith('d0000000-0000-4000-8000-000000000001');
    });

    it('should queue what waits for a setup every half hour, one pass at a time', async (): Promise<void> => {
      expect(CONVERSION_SWEEP_JOB.cron).toBe('*/30 * * * *');
      expect(CONVERSION_SWEEP_JOB.policy).toMatchObject({ policy: 'exclusive', retryLimit: 0, expireInSeconds: 1500 });

      await (CONVERSION_SWEEP_JOB.createHandler(fastify) as () => Promise<void>)();

      expect(tracking.sweep).toHaveBeenCalledTimes(1);
    });
  });
});
