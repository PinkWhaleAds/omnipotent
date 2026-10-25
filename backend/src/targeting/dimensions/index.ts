import { z } from 'zod';

import { ListKind, TargetingDimension, TargetingDimensionDescriptor } from '@src/types';
import { httpError, toJsonSchema } from '@utils';
import { AUDIENCE_DIMENSIONS } from './audience';
import { CONTENT_DIMENSIONS } from './content';
import { DELIVERY_DIMENSIONS } from './delivery';
import { DimensionDescriptor } from './descriptor';
import { GEO_DIMENSIONS } from './geo';
import { INVENTORY_DIMENSIONS } from './inventory';
import { QUALITY_DIMENSIONS } from './quality';
import { TECHNICAL_DIMENSIONS } from './technical';

export * from './descriptor';

/**
 * Every dimension a TargetingGroup can be targeted on, with what it accepts.
 *
 * Grouped by what it answers — where, on what, to whom, which inventory, around which content, at
 * which quality, when — and assembled here. The `satisfies` is the guard that matters: a dimension
 * added to the enumeration and forgotten here, or declared here and absent from the enumeration,
 * fails the build.
 *
 * Adding a dimension is therefore **one entry in the file of its theme**, and nothing else: no
 * service, no route and no tool changes (`docs/phase-5.md` § 2).
 */
export const TARGETING_DIMENSIONS = {
  ...GEO_DIMENSIONS,
  ...TECHNICAL_DIMENSIONS,
  ...AUDIENCE_DIMENSIONS,
  ...INVENTORY_DIMENSIONS,
  ...CONTENT_DIMENSIONS,
  ...QUALITY_DIMENSIONS,
  ...DELIVERY_DIMENSIONS,
} satisfies Record<TargetingDimension, DimensionDescriptor>;

/**
 * The descriptor of one dimension.
 *
 * @param dimension - The dimension
 * @returns Its descriptor
 *
 * @example
 * ```typescript
 * descriptorOf('country').family; // 'include_exclude'
 * ```
 */
export function descriptorOf(dimension: TargetingDimension): DimensionDescriptor {
  return TARGETING_DIMENSIONS[dimension];
}

/**
 * The kind of list a dimension expects, `null` when it expects none.
 *
 * @param dimension - The dimension
 * @returns The kind of list, or `null`
 */
export function listKindOf(dimension: TargetingDimension): ListKind | null {
  return descriptorOf(dimension).listKind;
}

/**
 * The dimensions of the registry, in the order of the enumeration.
 *
 * @returns Their ids
 */
export function allDimensions(): TargetingDimension[] {
  return Object.keys(TARGETING_DIMENSIONS) as TargetingDimension[];
}

/**
 * Validate the criteria of one dimension, and answer them with their defaults applied.
 *
 * The **only** door to the schemas: a caller never reaches into the registry itself, so there is one
 * place where a criterion is judged and one error code for the whole family of refusals.
 *
 * @param dimension - The dimension the criteria belong to
 * @param criteria - What the caller sent
 * @returns The criteria, parsed — always an object, every dimension of the registry being one
 * @throws Error with status 400 coded `targeting_criteria_invalid` when the shape does not hold
 *
 * @example
 * ```typescript
 * parseCriteria('country', { include: ['FR'] }); // { include: ['FR'], exclude: [] }
 * ```
 */
export function parseCriteria(dimension: TargetingDimension, criteria: unknown): object {
  const parsed: z.ZodSafeParseResult<unknown> = descriptorOf(dimension).schema.safeParse(criteria);
  if (!parsed.success) {
    // Every issue, joined: a criterion refused for two reasons says both, and there is no fallback
    // branch for a case Zod does not produce.
    const reason: string = parsed.error.issues.map((issue: z.core.$ZodIssue): string => issue.message).join('; ');
    throw httpError(400, `The criteria of ${dimension} do not hold: ${reason}`, {
      code: 'targeting_criteria_invalid',
      params: { dimension, reason },
    });
  }
  return parsed.data as object;
}

/**
 * The registry as the discovery route answers it: what can be targeted, and the shape of each.
 *
 * The JSON Schema travels with the descriptor so that nothing — a front, a model, a test — holds a
 * copy of a form that lives here (`docs/phase-5.md` § 2).
 *
 * @returns One descriptor per dimension, in the order of the enumeration
 */
export function dimensionCatalog(): TargetingDimensionDescriptor[] {
  return allDimensions().map((dimension: TargetingDimension): TargetingDimensionDescriptor => {
    const descriptor: DimensionDescriptor = descriptorOf(dimension);
    return {
      dimension,
      label: descriptor.label,
      family: descriptor.family,
      listKind: descriptor.listKind,
      criteriaSchema: toJsonSchema(descriptor.schema, 'input') as Record<string, unknown>,
    };
  });
}

/**
 * The stored targeting object, as the API answers it and accepts it whole.
 *
 * Composed **from the registry**, so the contract of a dimension is written once: its schema
 * validates a single-dimension write, and the same schema documents the whole object in Swagger. A
 * dimension absent from the object simply restricts nothing.
 */
export const targetingObjectSchema = z.strictObject(
  Object.fromEntries(
    allDimensions().map((dimension: TargetingDimension): [TargetingDimension, z.ZodType] => [
      dimension,
      descriptorOf(dimension).schema.optional(),
    ])
  )
);

/**
 * Validate a whole targeting object, dimension by dimension.
 *
 * Answers the criteria with their defaults applied, which is what gets stored: so an
 * `{ include: ['FR'] }` read back carries its empty `exclude`, and a front never has to guess.
 *
 * @param targeting - The object the caller sent
 * @returns The object, parsed
 * @throws Error with status 400 coded `targeting_criteria_invalid` for the first dimension that does
 *   not hold
 *
 * @example
 * ```typescript
 * parseTargeting({ country: { include: ['FR'] } });
 * ```
 */
export function parseTargeting(targeting: Record<string, unknown>): Record<string, object> {
  const parsed: Record<string, object> = {};
  for (const [dimension, criteria] of Object.entries(targeting)) {
    parsed[dimension] = parseCriteria(dimension as TargetingDimension, criteria);
  }
  return parsed;
}
