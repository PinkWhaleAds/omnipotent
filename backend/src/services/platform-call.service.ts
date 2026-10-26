import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { DataSource } from 'typeorm';

import { PlatformCallEntity } from '@src/database/entities';
import { Platform } from '@src/types';
import { Logger, LoggerBuilder } from '@utils';

/**
 * One call to a platform, as the journal records it.
 *
 * The **path, never the payload**: a request body carries targeting, creatives and sometimes a
 * token, and a journal is read by far more people than a secret store is
 * (`../../CADRAGE.md` § 12).
 *
 * @property platform - The platform
 * @property adAccountId - The account the call used, `null` when it used none
 * @property method - HTTP method
 * @property path - Path, without the query string, which can carry a signature
 * @property statusCode - HTTP status, `null` when no response came back
 * @property durationMs - How long it took
 * @property requestId - The id the platform gave, for its own support
 * @property error - What went wrong, when it did
 * @property operations - What it cost against the platform's quota (D45)
 */
export type PlatformCallRecord = {
  platform: Platform;
  adAccountId: string | null;
  method: string;
  path: string;
  statusCode: number | null;
  durationMs: number;
  requestId: string | null;
  error: string | null;
  operations: number;
};

/** Records platform calls. Recording never fails a call. */
export interface CallJournal {
  /**
   * Record one call, without waiting for it to be written.
   *
   * @param call - The call
   * @returns Nothing
   */
  record(call: PlatformCallRecord): void;
}

/**
 * The journal of the platform calls, in `platform_calls`.
 *
 * One line per call (`../../CADRAGE.md` § 14): it is what a failed sync is debugged with, and what
 * the later phases read the platform incidents and the quota consumption from. The quotas are the
 * whole project's and not one client's (D45), which is why an operation count is kept from the very
 * first call rather than added later.
 *
 * Writing happens **in the background**: a failed insert is logged and never fails the call it was
 * meant to describe. A journal that can break a sync is worse than no journal.
 */
export class PlatformCallJournal implements CallJournal {
  /** @internal Logger of the inserts that failed. */
  private readonly logger: Logger = LoggerBuilder.getChildLogger('PlatformCallJournal');

  /**
   * @param dataSource - Application database
   */
  constructor(private readonly dataSource: DataSource) {}

  /** @inheritdoc */
  public record(call: PlatformCallRecord): void {
    void this.dataSource
      .getRepository(PlatformCallEntity)
      .insert({ ...call, path: call.path.slice(0, 512), requestId: call.requestId?.slice(0, 128) ?? null })
      .catch((error: unknown): void => {
        this.logger.warn('Could not record a platform call', { error });
      });
  }
}

/**
 * Fastify plugin that decorates the instance with the {@link PlatformCallJournal}.
 *
 * Depends on `DatabasePlugin`.
 *
 * @param fastify - The Fastify instance to decorate
 * @returns A promise that resolves once decorated
 */
async function platformCallJournalPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate('platformCallJournal', new PlatformCallJournal(fastify.db));
}

export default fastifyPlugin(platformCallJournalPlugin, {
  name: 'PlatformCallJournalPlugin',
  dependencies: ['DatabasePlugin'],
});
