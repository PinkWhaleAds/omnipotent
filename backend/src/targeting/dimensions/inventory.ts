import { z } from 'zod';

import { TargetingDimension } from '@src/types';
import { includeExclude, opaqueIds, range } from '../families';
import { dimension, DimensionDescriptor, listsOf } from './descriptor';

/** A hostname, as a publisher's inventory names it. */
const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(253)
  .regex(/^[a-z0-9.-]+$/, 'A domain holds letters, digits, dots and hyphens');

/** How many impressions one play of a DOOH screen is worth, as Hawk counts them (`leviers.md`). */
const MAX_AUDIENCE_MULTIPLIER = 10_000;

/** Which inventory delivery is bought on. */
export const INVENTORY_DIMENSIONS = {
  exchange: dimension('Places de marché', 'opaque_ids', opaqueIds()),
  supply_source: dimension('Sources d’inventaire', 'opaque_ids', opaqueIds()),
  inventory_source: dimension('Offres d’inventaire', 'opaque_ids', opaqueIds()),
  publisher: dimension('Éditeurs', 'opaque_ids', opaqueIds()),
  domain: dimension('Domaines', 'include_exclude', includeExclude(domainSchema)),
  app: dimension('Applications', 'opaque_ids', opaqueIds()),
  app_site_name: dimension('Sites et applications nommés', 'opaque_ids', opaqueIds()),
  placement: dimension('Emplacements', 'opaque_ids', opaqueIds()),
  screen: dimension('Écrans', 'opaque_ids', opaqueIds()),
  multiplier: dimension(
    'Multiplicateur d’audience',
    'range',
    range({ min: 1, max: MAX_AUDIENCE_MULTIPLIER, integer: true })
  ),
  app_site_lists: listsOf('Listes de sites et applications', 'app_site'),
  publisher_lists: listsOf('Listes d’éditeurs', 'publisher'),
  placement_lists: listsOf('Listes d’emplacements', 'placement'),
  supply_lists: listsOf('Listes de sources d’inventaire', 'supply'),
  screen_lists: listsOf('Listes d’écrans', 'screen'),
} satisfies Partial<Record<TargetingDimension, DimensionDescriptor>>;
