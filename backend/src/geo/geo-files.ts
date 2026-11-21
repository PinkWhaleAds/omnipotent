/**
 * @module geo/geo-files
 *
 * Reading the files of places the platforms publish — Google's catalog now, Microsoft's file with lot
 * B of phase 11 —, both CSV with a header line, sometimes compressed. Transcribed from multi-search
 * (`src/geo/geo-files.ts`, our code).
 */
import { Readable } from 'node:stream';
import { gunzipSync } from 'node:zlib';

import { parse as parseCsv, Parser } from 'csv-parse';
import { unzipSync, Unzipped, UnzipFileInfo } from 'fflate';

/** Largest file read, once decompressed (Google's catalog is about 25 MB). */
export const MAX_GEO_FILE_BYTES = 300 * 1024 * 1024;

/** Bytes handed to the CSV parser at once, so a large file is never turned into one string. */
const CHUNK_BYTES = 1024 * 1024;

/**
 * The CSV inside a file: a ZIP archive gives its first `.csv` entry (the only one decompressed), a
 * gzip stream its content, anything else is taken as it is.
 *
 * @param content - The file as downloaded
 * @returns The CSV
 * @throws Error for an archive without CSV, or a content over {@link MAX_GEO_FILE_BYTES} once
 *   decompressed
 */
export function unpackCsv(content: Buffer): Buffer {
  if (content.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    let found = false;
    const files: Unzipped = unzipSync(content, {
      // An entry is decompressed into what it declares, at most the limit: never more than one of them.
      filter: (file: UnzipFileInfo): boolean => {
        if (found || !file.name.toLowerCase().endsWith('.csv') || file.originalSize > MAX_GEO_FILE_BYTES) return false;
        found = true;
        return true;
      },
    });
    const csv: Uint8Array | undefined = Object.values(files)[0];
    if (!csv) throw new Error(`The archive holds no CSV file of ${MAX_GEO_FILE_BYTES / 1048576} MB at most`);
    return Buffer.from(csv);
  }
  if (content[0] === 0x1f && content[1] === 0x8b) return gunzipSync(content, { maxOutputLength: MAX_GEO_FILE_BYTES });
  return content;
}

/**
 * The records of a CSV file with a header line, one object per line keyed by the column names, read
 * as a stream. Only the required columns are kept — the publishers may add columns at any time —,
 * trimmed; a short line gets empty values.
 *
 * @param content - The CSV, UTF-8 (a byte order mark is ignored)
 * @param requiredColumns - Columns the header must have
 * @returns The records
 * @throws Error when a required column is missing or the file is not valid CSV
 */
export async function* readCsvRecords(
  content: Buffer,
  requiredColumns: readonly string[]
): AsyncGenerator<Record<string, string>> {
  const parser: Parser = parseCsv({
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    columns: (header: string[]): string[] => {
      const names: string[] = header.map((name: string): string => name.trim());
      const missing: string[] = requiredColumns.filter((column: string): boolean => !names.includes(column));
      if (missing.length > 0) throw new Error(`The file has no column ${missing.join(', ')}`);
      return names;
    },
  });
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < content.length; offset += CHUNK_BYTES) {
    chunks.push(content.subarray(offset, offset + CHUNK_BYTES));
  }
  Readable.from(chunks).pipe(parser);
  for await (const record of parser as AsyncIterable<Record<string, string | undefined>>) {
    yield Object.fromEntries(
      requiredColumns.map((column: string): [string, string] => [column, (record[column] ?? '').trim()])
    );
  }
}
