import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { DataSource, EntityManager } from 'typeorm';

import { geoConfig } from '@configs';
import { GeoLocationEntity } from '@src/database/entities';
import { MAX_GEO_FILE_BYTES, readCsvRecords, unpackCsv } from '@src/geo/geo-files';
import {
  ACTIVE_STATUS,
  downloadGeoTargets,
  GeoFileFetcher,
  GeoTargetRow,
  GOOGLE_GEO_TARGET_COLUMNS,
  parseGoogleGeoTarget,
  REMOVAL_PLANNED_STATUS,
} from '@src/geo/google-geo-targets';
import { Logger, LoggerBuilder } from '@utils';

/** Places written in one statement. */
export const GEO_IMPORT_BATCH_SIZE = 5000;

/**
 * Smallest share of the active places already kept that a new catalog must hold: a shorter file is
 * taken for a truncated one, and nothing changes.
 */
export const GEO_IMPORT_MIN_RATIO = 0.5;

/** How long a download may take, in milliseconds. */
const DOWNLOAD_TIMEOUT_MS = 120_000;

/**
 * Upsert of a batch of places, one array per column, all stamped with the time of the import (`$10`),
 * so that the places a new catalog no longer holds are told apart afterwards.
 */
const UPSERT_SQL = `INSERT INTO "geo_locations"
  ("id", "name", "canonical_name", "search_text", "parent_id", "country_code", "target_type", "level", "status", "updated_at")
SELECT "id", "name", "canonical_name", "search_text", "parent_id", "country_code", "target_type", "level", "status", $10
FROM unnest($1::varchar[], $2::varchar[], $3::varchar[], $4::varchar[], $5::varchar[], $6::bpchar[], $7::varchar[],
  $8::varchar[], $9::varchar[])
  AS "row" ("id", "name", "canonical_name", "search_text", "parent_id", "country_code", "target_type", "level", "status")
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "canonical_name" = EXCLUDED."canonical_name",
  "search_text" = EXCLUDED."search_text",
  "parent_id" = EXCLUDED."parent_id",
  "country_code" = EXCLUDED."country_code",
  "target_type" = EXCLUDED."target_type",
  "level" = EXCLUDED."level",
  "status" = EXCLUDED."status",
  "updated_at" = EXCLUDED."updated_at"`;

/** Places a new catalog no longer holds: Google removed them, they are no longer offered. `$1` the import time. */
const RETIRE_SQL = `UPDATE "geo_locations" SET "status" = '${REMOVAL_PLANNED_STATUS}', "updated_at" = $1
WHERE "updated_at" < $1 AND "status" <> '${REMOVAL_PLANNED_STATUS}'`;

/** The job that imports the catalog (`src/jobs/index.ts`). */
export const GEO_IMPORT_JOB_NAME = 'geo.import';

/**
 * Queues an import of the catalog on the job queue.
 *
 * @param data - The payload of the job
 * @returns The id of the job, `null` when one is already queued or running (its queue is `exclusive`)
 */
export type GeoImportScheduler = (data: { whenEmpty: true }) => Promise<string | null>;

/**
 * What an import of Google's catalog did.
 *
 * @property url - The file read
 * @property places - Places written
 * @property skipped - Lines that did not fit `geo_locations`
 * @property retired - Places the file no longer holds, now `Removal Planned`
 */
export type GeoImportSummary = { url: string; places: number; skipped: number; retired: number };

/**
 * Loads the referential of places: Google's catalog into `geo_locations` (`docs/phase-10.md` § 8.9).
 * Transcribed from multi-search (`src/services/geo-import.service.ts`), run by the job `geo.import`:
 * monthly, and at a worker's start when the referential is empty.
 *
 * Two things multi-search does are not here: an import a super-admin asks for, Omnipotent having no
 * role above the Organizations (§ 8.9, point 7), and the ids Microsoft gives the places, which come
 * with lot B of phase 11.
 */
export class GeoImportService {
  /** @internal Logger scoped to this class. */
  private readonly logger: Logger = LoggerBuilder.getChildLogger('GeoImportService');

  /**
   * Create the service.
   *
   * @param dataSource - Application database
   * @param schedule - Queues an import
   * @param download - Downloads the catalog: the configured file, or the latest one Google's page links
   * @param now - Clock, injectable so a test owns it
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly schedule: GeoImportScheduler,
    private readonly download: () => Promise<{ url: string; content: Buffer }>,
    private readonly now: () => Date = (): Date => new Date()
  ) {}

  /**
   * Queue an import of Google's catalog that runs only if the referential is empty — a new database —:
   * run at each worker's start. The job checks the table itself, so that a database still connecting
   * delays it (retries) instead of skipping it.
   *
   * @returns Whether a job was queued (`false` when an import is already queued or running)
   */
  public async queueWhenEmpty(): Promise<boolean> {
    return (await this.schedule({ whenEmpty: true })) !== null;
  }

  /**
   * Import Google's catalog, in one transaction: upsert every place in batches, mark
   * `Removal Planned` the places the file no longer holds; then refresh the statistics of the table.
   *
   * @param options - What the import is for
   * @param options.whenEmpty - Import only if the referential is empty (the import queued at a worker's start)
   * @returns What the import did, or `null` when skipped because places are kept
   * @throws Error when the file cannot be downloaded or read, or holds fewer than
   *   {@link GEO_IMPORT_MIN_RATIO} of the active places already kept (nothing is changed then)
   */
  public async importGoogle(options: { whenEmpty?: boolean } = {}): Promise<GeoImportSummary | null> {
    if (options.whenEmpty) {
      if (await this.dataSource.getRepository(GeoLocationEntity).existsBy({})) return null;
      this.logger.info('The referential of places is empty: Google geo targets are imported');
    }
    const { url, content } = await this.download();
    const importedAt: Date = this.now();
    const summary: GeoImportSummary = await this.dataSource.transaction(
      async (manager: EntityManager): Promise<GeoImportSummary> => {
        const active: number = await manager.countBy(GeoLocationEntity, { status: ACTIVE_STATUS });
        let places = 0;
        let skipped = 0;
        let batch = new Map<string, GeoTargetRow>();
        for await (const record of readCsvRecords(unpackCsv(content), GOOGLE_GEO_TARGET_COLUMNS)) {
          const row: GeoTargetRow | null = parseGoogleGeoTarget(record);
          if (!row) {
            skipped += 1;
            continue;
          }
          batch.set(row.id, row);
          if (batch.size >= GEO_IMPORT_BATCH_SIZE) {
            places += await this.upsert(manager, [...batch.values()], importedAt);
            batch = new Map();
          }
        }
        places += await this.upsert(manager, [...batch.values()], importedAt);
        if (places < active * GEO_IMPORT_MIN_RATIO) {
          throw new Error(`The geo targets file ${url} holds ${places} places for ${active} kept: it looks truncated`);
        }
        const retired: number = await this.retire(manager, importedAt);
        return { url, places, skipped, retired };
      }
    );
    // Fresh statistics: planned with those of a smaller table, the search joins the parents in a nested loop.
    await this.dataSource.query('ANALYZE "geo_locations"');
    this.logger.info(
      `Imported ${summary.places} places from ${summary.url} (${summary.skipped} lines skipped, ` +
        `${summary.retired} places retired)`
    );
    return summary;
  }

  /**
   * Write a batch of places.
   *
   * @param manager - Entity manager of the transaction
   * @param rows - The places, each id once
   * @param importedAt - Time of the import
   * @returns How many were written
   */
  private async upsert(manager: EntityManager, rows: GeoTargetRow[], importedAt: Date): Promise<number> {
    if (rows.length === 0) return 0;
    const column = <K extends keyof GeoTargetRow>(key: K): GeoTargetRow[K][] =>
      rows.map((row: GeoTargetRow): GeoTargetRow[K] => row[key]);
    await manager.query(UPSERT_SQL, [
      column('id'),
      column('name'),
      column('canonicalName'),
      column('searchText'),
      column('parentId'),
      column('countryCode'),
      column('targetType'),
      column('level'),
      column('status'),
      importedAt,
    ]);
    return rows.length;
  }

  /**
   * Mark `Removal Planned` the places an import did not write.
   *
   * @param manager - Entity manager of the transaction
   * @param importedAt - Time of the import
   * @returns How many places were retired
   */
  private async retire(manager: EntityManager, importedAt: Date): Promise<number> {
    const result: [unknown[], number] = await manager.query(RETIRE_SQL, [importedAt]);
    return result[1];
  }
}

/**
 * Downloads a configured URL — Google's page or file, never a URL a client sent —, refusing a body
 * larger than {@link MAX_GEO_FILE_BYTES} before it is all in memory.
 *
 * Written on `fetch`, as every other call of this repository, rather than on the `axios` of
 * multi-search (`src/platforms/platform-http.ts`).
 *
 * @param url - The URL
 * @returns The content
 * @throws Error on a status other than 2xx, or a body over the limit
 */
export const fetchGeoFile: GeoFileFetcher = async (url: string): Promise<Buffer> => {
  const response: Response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Downloading ${url} answered ${response.status}`);
  if (response.body === null) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > MAX_GEO_FILE_BYTES) {
      throw new Error(`Downloading ${url} gave more than ${MAX_GEO_FILE_BYTES / 1048576} MB`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

/**
 * Fastify plugin that decorates the instance with a {@link GeoImportService}: Google's catalog read
 * from `Geo.googleTargetsUrl`, an import queued on the job queue.
 *
 * Depends on `DatabasePlugin` and `JobQueuePlugin`.
 *
 * @param fastify - The Fastify instance to decorate
 * @returns A promise that resolves once decorated
 */
async function geoImportServicePlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate(
    'geoImportService',
    new GeoImportService(
      fastify.db,
      (data: { whenEmpty: true }): Promise<string | null> => fastify.jobQueue.send(GEO_IMPORT_JOB_NAME, data),
      (): Promise<{ url: string; content: Buffer }> => downloadGeoTargets(geoConfig.googleTargetsUrl, fetchGeoFile)
    )
  );
}

export default fastifyPlugin(geoImportServicePlugin, {
  name: 'GeoImportServicePlugin',
  dependencies: ['DatabasePlugin', 'JobQueuePlugin'],
});
