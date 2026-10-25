import { z } from 'zod';

import { ListKind, TargetingFamily } from '@src/types';
import { listReference } from '../families';

/**
 * What the registry says about one dimension (`docs/phase-5.md` § 2).
 *
 * @property label - Its name, as the French front shows it without translating it
 * @property family - The shape of its criteria, for the discovery answer
 * @property schema - The validation of its criteria, the source of truth of its form
 * @property listKind - For a `list_reference`, the kind of list it expects; `null` otherwise
 */
export type DimensionDescriptor = {
  label: string;
  family: TargetingFamily;
  schema: z.ZodType;
  listKind: ListKind | null;
};

/**
 * Declare a dimension.
 *
 * @param label - Its name
 * @param family - The shape of its criteria
 * @param schema - The validation of its criteria
 * @returns Its descriptor
 *
 * @example
 * ```typescript
 * dimension('Pays', 'include_exclude', includeExclude(countryCodeSchema));
 * ```
 */
export function dimension(label: string, family: TargetingFamily, schema: z.ZodType): DimensionDescriptor {
  return { label, family, schema, listKind: null };
}

/**
 * Declare a dimension that points at reusable lists of the Organization.
 *
 * The kind it carries is what the service checks the lists against: a list of POIs does not plug into
 * a dimension of sites.
 *
 * @param label - Its name
 * @param listKind - The kind of list it expects
 * @returns Its descriptor
 *
 * @example
 * ```typescript
 * listsOf('Listes de sites et applications', 'app_site');
 * ```
 */
export function listsOf(label: string, listKind: ListKind): DimensionDescriptor {
  return { label, family: 'list_reference', schema: listReference(), listKind };
}
