import { gzipSync } from 'node:zlib';

import { strToU8, zipSync } from 'fflate';

import { MAX_GEO_FILE_BYTES, readCsvRecords, unpackCsv } from '@src/geo/geo-files';

/**
 * A ZIP whose entries declare other uncompressed sizes than theirs, as a hostile archive does.
 *
 * @param files - The entries
 * @param declared - Size each entry declares, by name
 * @returns The archive
 */
function zipDeclaring(files: Record<string, Uint8Array>, declared: Record<string, number>): Buffer {
  const zip: Buffer = Buffer.from(zipSync(files, { level: 0 }));
  for (let offset = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); offset !== -1;) {
    const nameLength: number = zip.readUInt16LE(offset + 28);
    const name: string = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (name in declared) zip.writeUInt32LE(declared[name], offset + 24);
    offset = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), offset + 46);
  }
  return zip;
}

/**
 * Read every record of a CSV.
 *
 * @param content - The CSV
 * @param columns - Required columns
 * @returns The records
 */
async function readAll(content: Buffer, columns: string[]): Promise<Record<string, string>[]> {
  const records: Record<string, string>[] = [];
  for await (const record of readCsvRecords(content, columns)) records.push(record);
  return records;
}

describe('Unit::Geo::GeoFiles', () => {
  const CSV = 'Criteria ID,Name\n"1006094","Paris"\n';

  describe('unpackCsv', () => {
    it('should keep a plain file as it is', (): void => {
      const content: Buffer = Buffer.from(CSV);

      expect(unpackCsv(content)).toBe(content);
    });

    it('should take the CSV of a ZIP archive', (): void => {
      const archive: Buffer = Buffer.from(
        zipSync({ 'readme.txt': strToU8('Google geo targets'), 'geotargets-2026-08-12.csv': strToU8(CSV) })
      );

      expect(unpackCsv(archive).toString('utf8')).toBe(CSV);
    });

    it('should refuse an archive without CSV', (): void => {
      const archive: Buffer = Buffer.from(zipSync({ 'readme.txt': strToU8('nothing') }));

      expect(() => unpackCsv(archive)).toThrow(
        `The archive holds no CSV file of ${MAX_GEO_FILE_BYTES / 1048576} MB at most`
      );
    });

    it('should decompress the first CSV only, never one declaring more than the limit', (): void => {
      const archive: Buffer = zipDeclaring(
        { 'huge.csv': strToU8('x'), 'first.csv': strToU8(CSV), 'second.csv': strToU8('other') },
        { 'huge.csv': MAX_GEO_FILE_BYTES + 1 }
      );

      expect(unpackCsv(archive).toString('utf8')).toBe(CSV);
    });

    it('should decompress a gzip stream', (): void => {
      expect(unpackCsv(gzipSync(Buffer.from(CSV))).toString('utf8')).toBe(CSV);
    });
  });

  describe('readCsvRecords', () => {
    it('should read the required columns of each line, trimmed, ignoring the BOM, other columns and blank lines', async (): Promise<void> => {
      const content: Buffer = Buffer.from('﻿Location Id, Status ,Extra\n1, Active ,x\n\n2,Deprecated\n3\n');

      await expect(readAll(content, ['Location Id', 'Status'])).resolves.toEqual([
        { 'Location Id': '1', Status: 'Active' },
        { 'Location Id': '2', Status: 'Deprecated' },
        { 'Location Id': '3', Status: '' },
      ]);
    });

    it('should read a file of several chunks', async (): Promise<void> => {
      const lines: string[] = Array.from(
        { length: 60_000 },
        (_: unknown, index: number): string => `${index},Saint-Germain-en-Laye`
      );
      const content: Buffer = Buffer.from(`Criteria ID,Name\n${lines.join('\n')}\n`);
      expect(content.length).toBeGreaterThan(1024 * 1024);

      const records: Record<string, string>[] = await readAll(content, ['Criteria ID', 'Name']);

      expect(records).toHaveLength(60_000);
      expect(records[59_999]).toEqual({ 'Criteria ID': '59999', Name: 'Saint-Germain-en-Laye' });
    });

    it('should refuse a file without a required column', async (): Promise<void> => {
      await expect(readAll(Buffer.from(CSV), ['Criteria ID', 'Status', 'Target Type'])).rejects.toThrow(
        'The file has no column Status, Target Type'
      );
    });
  });
});
