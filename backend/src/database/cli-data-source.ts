/**
 * @module database/cli-data-source
 *
 * Entry point for the TypeORM CLI (`pnpm typeorm ...`, `pnpm migration:generate`).
 * The CLI requires a module exporting exactly one data source.
 */
import { createDataSource } from './data-source';

export default createDataSource();
