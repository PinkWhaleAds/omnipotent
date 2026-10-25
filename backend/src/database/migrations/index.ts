/**
 * @module database/migrations
 *
 * Ordered list of every migration. Listed explicitly (rather than found by a
 * glob) so the same list works from TypeScript sources and from the compiled build.
 * Add each new migration at the end.
 *
 * The socle carries no migration because it carries no entity: each phase generates its own with
 * `pnpm migration:generate src/database/migrations/<Name>`, reviews the SQL, and adds the class
 * here. `synchronize` is never enabled (`CLAUDE.md`), and the integration suite fails when the
 * entities and the migrated schema disagree.
 */
export const MIGRATIONS: (new () => unknown)[] = [];
