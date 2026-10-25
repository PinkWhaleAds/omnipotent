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
