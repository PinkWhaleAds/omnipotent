/**
 * Escape the `LIKE` wildcards of user input so they match literally.
 *
 * @param text - Raw search text
 * @returns The text with `%`, `_` and backslashes escaped
 *
 * @example
 * ```typescript
 * where.name = ILike(`%${escapeLike(query.search)}%`);
 * ```
 */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character: string): string => `\\${character}`);
}

/** Combining diacritical marks: what Unicode decomposition (NFD) splits off accented letters. */
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * A text without its accents, as {@link withoutAccentsSql} compares it: decomposed (NFD), its combining marks
 * removed. Letters without decomposition (`ø`, `œ`, `ß`) stay.
 *
 * @param text - The text
 * @returns The text without accents
 *
 * @example
 * ```typescript
 * withoutAccents('Herbéa Noël'); // 'Herbea Noel'
 * ```
 */
export function withoutAccents(text: string): string {
  return text.normalize('NFD').replace(COMBINING_MARKS, '');
}

/**
 * An SQL expression giving a text without its accents, the way {@link withoutAccents} removes them (PostgreSQL's
 * own `normalize`, no extension needed). Compare it with `ILIKE` to search without case nor accents.
 *
 * @param expression - SQL expression of the text, e.g. a column
 * @returns The SQL expression
 *
 * @example
 * ```typescript
 * where.name = Raw((alias: string): string => `${withoutAccentsSql(alias)} ILIKE :pattern`, {
 *   pattern: `%${escapeLike(withoutAccents(search))}%`,
 * });
 * ```
 */
export function withoutAccentsSql(expression: string): string {
  return `regexp_replace(normalize(${expression}, NFD), '[\\u0300-\\u036f]', '', 'g')`;
}
