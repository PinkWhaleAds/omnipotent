/**
 * @module database/migrations
 *
 * Ordered list of every migration. Listed explicitly (rather than found by a
 * glob) so the same list works from TypeScript sources and from the compiled build.
 * Add each new migration at the end.
 *
 * The schema only ever changes here: change the entity, run
 * `pnpm migration:generate src/database/migrations/<Name>`, read the SQL it produced, add the class
 * below. `synchronize` is never enabled (`CLAUDE.md`), and the integration suite fails when the
 * entities and the migrated schema disagree.
 */
import { AdvertisersAndLabels1792936887388 } from './1792936887388-AdvertisersAndLabels';
import { BudgetDays1792962958804 } from './1792962958804-BudgetDays';
import { CampaignTree1792952658715 } from './1792952658715-CampaignTree';
import { Targeting1792967310499 } from './1792967310499-Targeting';
import { AssetsAndCreatives1793007739192 } from './1793007739192-AssetsAndCreatives';
import { PlatformAccounts1793010942785 } from './1793010942785-PlatformAccounts';
import { Sync1793045657967 } from './1793045657967-Sync';

export const MIGRATIONS: (new () => unknown)[] = [
  AdvertisersAndLabels1792936887388,
  CampaignTree1792952658715,
  BudgetDays1792962958804,
  Targeting1792967310499,
  AssetsAndCreatives1793007739192,
  PlatformAccounts1793010942785,
  Sync1793045657967,
];
