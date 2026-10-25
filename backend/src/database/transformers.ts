import { ValueTransformer } from 'typeorm';

/**
 * Maps a PostgreSQL `numeric` column to a JavaScript number.
 *
 * The `pg` driver returns `numeric` as a string so no precision is lost; the
 * amounts stored here have two decimals and stay far below 2^53 cents, so a
 * number is exact enough. Money computations are done in integer cents anyway.
 *
 * @example
 * ```typescript
 * @Column({ type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer })
 * totalBudget!: number;
 * ```
 */
export const numericTransformer: ValueTransformer = {
  to: (value: number | null | undefined): number | null | undefined => value,
  from: (value: string | null): number | null => (value === null ? null : Number(value)),
};

/**
 * Maps a PostgreSQL `bigint` column holding **integer cents** to a JavaScript number.
 *
 * Money is computed in integer cents everywhere (`CLAUDE.md`), and a cent amount is stored in a
 * `bigint` rather than an `integer` because an `integer` caps at about 21 million euros — plausible
 * for a yearly plan, and a ceiling nobody would see coming. The `pg` driver returns a `bigint` as a
 * string so no precision is lost; cents stay far below 2^53, so a number is exact.
 *
 * @example
 * ```typescript
 * @Column({ type: 'bigint', nullable: true, transformer: centsTransformer })
 * budgetCents!: number | null;
 * ```
 */
export const centsTransformer: ValueTransformer = {
  to: (value: number | null | undefined): number | null | undefined => value,
  from: (value: string | null): number | null => (value === null ? null : Number(value)),
};
