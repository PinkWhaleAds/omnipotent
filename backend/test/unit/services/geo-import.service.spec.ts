import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

import { gzipSync } from 'node:zlib';

import { FastifyInstance } from 'fastify';

import { GOOGLE_GEO_TARGETS_PAGE_URL } from '@configs';
import { GeoLocationEntity } from '@src/database/entities';
import { MAX_GEO_FILE_BYTES } from '@src/geo/geo-files';
import GeoImportServicePlugin, {
  fetchGeoFile,
  GEO_IMPORT_BATCH_SIZE,
  GeoImportService,
} from '@src/services/geo-import.service';
import { buildServiceApp, createAccessMock } from '@test/unit/mocks/access.mock';
import { createDataSourceMock, DataSourceMock } from '@test/unit/mocks/data-source.mock';
import { closeTestApp } from '@test/utils/fastify-test-app.utils';

/** A fixed instant, so a spec owns the clock. */
const NOW: Date = new Date('2026-11-21T03:00:00.000Z');

/** Header of Google's catalog. */
const HEADER = 'Criteria ID,Name,Canonical Name,Parent ID,Country Code,Target Type,Status';

/**
 * A catalog of places.
 *
 * @param lines - Its lines, header excluded
 * @returns The file
 */
function catalog(lines: string[]): Buffer {
  return Buffer.from([HEADER, ...lines].join('\n'));
}

/** Two places, a line Google would never write, and Paris again. */
const LINES: string[] = [
  '"2250","France","France","","FR","Country",Active',
  '"1006094","Paris","Paris,Paris,Ile-de-France,France","9040871","FR","City",Active',
  '"abc","Broken","Broken","","FR","City",Active',
  '"1006094","Paris","Paris,Paris,Ile-de-France,France","9040871","FR","City",Removal Planned',
];

/** Google's catalog URL the download answers. */
const FILE_URL = 'https://developers.google.com/static/google-ads/api/data/geo/geotargets-2026-08-12.csv.zip';

describe('Unit::Services::GeoImportService', () => {
  let db: DataSourceMock;
  let managerQuery: jest.Mock;
  let schedule: jest.Mock;
  let download: jest.Mock;
  let service: GeoImportService;

  beforeEach((): void => {
    jest.clearAllMocks();
    db = createDataSourceMock();
    managerQuery = jest.fn(async (sql: string): Promise<unknown> => (sql.startsWith('UPDATE') ? [[], 3] : []));
    db.manager.query = managerQuery;
    schedule = jest.fn().mockResolvedValue('job-1');
    download = jest.fn().mockResolvedValue({ url: FILE_URL, content: gzipSync(catalog(LINES)) });
    service = new GeoImportService(db.dataSource, schedule, download, (): Date => NOW);
  });

  describe('queueWhenEmpty', () => {
    it('should queue an import that runs only into an empty referential, without reading the database', async (): Promise<void> => {
      await expect(service.queueWhenEmpty()).resolves.toBe(true);

      expect(schedule).toHaveBeenCalledWith({ whenEmpty: true });
      expect(db.repository(GeoLocationEntity).existsBy).not.toHaveBeenCalled();
    });

    it('should say when an import is already queued or running', async (): Promise<void> => {
      schedule.mockResolvedValue(null);

      await expect(service.queueWhenEmpty()).resolves.toBe(false);
    });
  });

  describe('importGoogle', () => {
    it('should upsert the places of the file in a transaction, retire the others, then refresh the statistics', async (): Promise<void> => {
      await expect(service.importGoogle()).resolves.toEqual({ url: FILE_URL, places: 2, skipped: 1, retired: 3 });

      expect(db.mocks.transaction).toHaveBeenCalledTimes(1);
      expect(db.manager.countBy).toHaveBeenCalledWith(GeoLocationEntity, { status: 'Active' });
      expect(managerQuery).toHaveBeenCalledTimes(2);
      const [upsert, values] = managerQuery.mock.calls[0];
      expect(upsert).toContain('INSERT INTO "geo_locations"');
      expect(upsert).toContain('ON CONFLICT ("id") DO UPDATE');
      // Paris is written once, as the last line of the file says it.
      expect(values).toEqual([
        ['2250', '1006094'],
        ['France', 'Paris'],
        ['France', 'Paris,Paris,Ile-de-France,France'],
        ['france | france', 'paris | paris paris ile de france france'],
        [null, '9040871'],
        ['FR', 'FR'],
        ['Country', 'City'],
        ['country', 'city'],
        ['Active', 'Removal Planned'],
        NOW,
      ]);
      expect(managerQuery.mock.calls[1]).toEqual([expect.stringContaining('UPDATE "geo_locations"'), [NOW]]);
      expect(db.mocks.query).toHaveBeenCalledWith('ANALYZE "geo_locations"');
      expect(loggerMock.info).toHaveBeenCalledWith(
        `Imported 2 places from ${FILE_URL} (1 lines skipped, 3 places retired)`
      );
    });

    it('should import into an empty referential when asked to import only then', async (): Promise<void> => {
      await expect(service.importGoogle({ whenEmpty: true })).resolves.toMatchObject({ places: 2 });

      expect(db.repository(GeoLocationEntity).existsBy).toHaveBeenCalledWith({});
      expect(loggerMock.info).toHaveBeenCalledWith(
        'The referential of places is empty: Google geo targets are imported'
      );
    });

    it('should skip an import asked only for an empty referential when places are kept', async (): Promise<void> => {
      db.repository(GeoLocationEntity).existsBy.mockResolvedValue(true);

      await expect(service.importGoogle({ whenEmpty: true })).resolves.toBeNull();

      expect(download).not.toHaveBeenCalled();
    });

    it('should write the places in batches', async (): Promise<void> => {
      const lines: string[] = Array.from(
        { length: GEO_IMPORT_BATCH_SIZE + 1 },
        (_: unknown, index: number): string =>
          `"${100000 + index}","75${index}","75${index},France","","FR","Postal Code",Active`
      );
      download.mockResolvedValue({ url: FILE_URL, content: catalog(lines) });

      await expect(service.importGoogle()).resolves.toMatchObject({ places: GEO_IMPORT_BATCH_SIZE + 1, skipped: 0 });

      const upserts: unknown[][] = managerQuery.mock.calls.filter((call: unknown[]): boolean =>
        String(call[0]).startsWith('INSERT')
      );
      expect(upserts.map((call: unknown[]): number => (call[1] as string[][])[0].length)).toEqual([
        GEO_IMPORT_BATCH_SIZE,
        1,
      ]);
    });

    it('should change nothing when the file holds less than half the active places kept', async (): Promise<void> => {
      db.manager.countBy.mockResolvedValue(10);

      await expect(service.importGoogle()).rejects.toThrow(
        `The geo targets file ${FILE_URL} holds 2 places for 10 kept: it looks truncated`
      );
      expect(managerQuery.mock.calls.some((call: unknown[]): boolean => String(call[0]).startsWith('UPDATE'))).toBe(
        false
      );
      expect(db.mocks.query).not.toHaveBeenCalled();
    });

    it('should import an empty catalog into an empty referential without writing', async (): Promise<void> => {
      download.mockResolvedValue({ url: FILE_URL, content: catalog([]) });

      await expect(service.importGoogle()).resolves.toEqual({ url: FILE_URL, places: 0, skipped: 0, retired: 3 });
      expect(managerQuery).toHaveBeenCalledTimes(1);
    });

    it('should fail when the file cannot be downloaded', async (): Promise<void> => {
      download.mockRejectedValue(new Error('timeout'));

      await expect(service.importGoogle()).rejects.toThrow('timeout');
      expect(db.mocks.transaction).not.toHaveBeenCalled();
    });

    it('should stamp the import with the real clock by default', async (): Promise<void> => {
      const before: number = Date.now();

      await new GeoImportService(db.dataSource, schedule, download).importGoogle();

      expect((managerQuery.mock.calls[0][1] as Date[])[9].getTime()).toBeGreaterThanOrEqual(before);
    });
  });

  describe('fetchGeoFile', () => {
    let fetchSpy: jest.SpyInstance;

    beforeEach((): void => {
      fetchSpy = jest.spyOn(global, 'fetch');
    });

    afterEach((): void => {
      fetchSpy.mockRestore();
    });

    it('should download the body of a configured URL, with a timeout', async (): Promise<void> => {
      fetchSpy.mockResolvedValue(new Response('Criteria ID,Name\n'));

      await expect(fetchGeoFile(FILE_URL)).resolves.toEqual(Buffer.from('Criteria ID,Name\n'));
      expect(fetchSpy).toHaveBeenCalledWith(FILE_URL, { signal: expect.any(AbortSignal) });
    });

    it('should give nothing for an answer without body', async (): Promise<void> => {
      fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));

      await expect(fetchGeoFile(FILE_URL)).resolves.toEqual(Buffer.alloc(0));
    });

    it('should fail on a status other than 2xx', async (): Promise<void> => {
      fetchSpy.mockResolvedValue(new Response('Not found', { status: 404 }));

      await expect(fetchGeoFile(FILE_URL)).rejects.toThrow(`Downloading ${FILE_URL} answered 404`);
    });

    it('should stop reading a body larger than the limit, before keeping it', async (): Promise<void> => {
      // A chunk that only says its size: the limit is judged on it, and nothing that large is allocated.
      const oversized = { length: MAX_GEO_FILE_BYTES + 1 } as unknown as Uint8Array;
      const body: AsyncIterable<Uint8Array> = {
        async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
          yield oversized;
        },
      };
      fetchSpy.mockResolvedValue({ ok: true, status: 200, body } as unknown as Response);

      await expect(fetchGeoFile(FILE_URL)).rejects.toThrow(
        `Downloading ${FILE_URL} gave more than ${MAX_GEO_FILE_BYTES / 1048576} MB`
      );
    });
  });

  describe('plugin', () => {
    let app: FastifyInstance;
    let jobQueue: { send: jest.Mock };
    let fetchSpy: jest.SpyInstance;

    beforeEach(async (): Promise<void> => {
      jobQueue = { send: jest.fn().mockResolvedValue('job-1') };
      fetchSpy = jest.spyOn(global, 'fetch');
      app = await buildServiceApp([GeoImportServicePlugin], { db, access: createAccessMock(), jobQueue });
    });

    afterEach(async (): Promise<void> => {
      fetchSpy.mockRestore();
      await closeTestApp(app);
    });

    it('should queue the import on the job queue', async (): Promise<void> => {
      await expect(app.geoImportService.queueWhenEmpty()).resolves.toBe(true);

      expect(jobQueue.send).toHaveBeenCalledWith('geo.import', { whenEmpty: true });
    });

    it("should read the latest file linked from Google's page", async (): Promise<void> => {
      fetchSpy
        .mockResolvedValueOnce(new Response(`<a href="${FILE_URL}">Latest</a>`))
        .mockResolvedValueOnce(new Response(new Uint8Array(gzipSync(catalog(LINES)))));

      await expect(app.geoImportService.importGoogle()).resolves.toMatchObject({ url: FILE_URL, places: 2 });

      expect(fetchSpy).toHaveBeenNthCalledWith(1, GOOGLE_GEO_TARGETS_PAGE_URL, expect.anything());
      expect(fetchSpy).toHaveBeenNthCalledWith(2, FILE_URL, expect.anything());
    });
  });
});
