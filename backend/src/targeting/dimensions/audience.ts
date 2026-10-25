import { z } from 'zod';

import { TargetingDimension } from '@src/types';
import { opaqueIds } from '../families';
import { dimension, DimensionDescriptor, listsOf } from './descriptor';

/** The age brackets the model names; a platform that brackets differently maps them. */
const ageRangeSchema = z.enum(['18_24', '25_34', '35_44', '45_54', '55_64', '65_plus', 'unknown']);

/** Genders, with the bucket a platform answers when it does not know. */
const genderSchema = z.enum(['male', 'female', 'other', 'unknown']);

/** Whether the household has children. */
const parentalStatusSchema = z.enum(['parent', 'not_parent', 'unknown']);

/** Household income, in deciles of the population, as the platforms express it. */
const incomeRangeSchema = z.enum(['top_10', '11_20', '21_30', '31_40', '41_50', 'lower_50', 'unknown']);

/**
 * Who sees the ad: the demographic dimension.
 *
 * Four sets, each optional, at least one filled — an empty demographic criterion restricts nothing,
 * and that is said by not carrying the dimension at all. The sets are **ANDed** by the platforms: a
 * woman of 25 to 34, not the union of the two.
 */
const demographicsSchema = z
  .strictObject({
    ageRanges: z.array(ageRangeSchema).max(ageRangeSchema.options.length).default([]),
    genders: z.array(genderSchema).max(genderSchema.options.length).default([]),
    parentalStatus: z.array(parentalStatusSchema).max(parentalStatusSchema.options.length).default([]),
    incomeRanges: z.array(incomeRangeSchema).max(incomeRangeSchema.options.length).default([]),
  })
  .refine(
    (criteria): boolean =>
      criteria.ageRanges.length > 0 ||
      criteria.genders.length > 0 ||
      criteria.parentalStatus.length > 0 ||
      criteria.incomeRanges.length > 0,
    'a demographic criterion must fill at least one of its sets'
  );

/** To whom delivery happens: the audience dimensions. */
export const AUDIENCE_DIMENSIONS = {
  demographics: dimension('Démographie', 'shape', demographicsSchema),
  audience: dimension('Audiences de la plateforme', 'opaque_ids', opaqueIds()),
  segment: dimension('Segments', 'opaque_ids', opaqueIds()),
  interest: dimension('Centres d’intérêt', 'opaque_ids', opaqueIds()),
  audience_lists: listsOf('Listes d’audiences', 'audience'),
  retargeting_lists: listsOf('Listes de retargeting', 'retargeting'),
} satisfies Partial<Record<TargetingDimension, DimensionDescriptor>>;
