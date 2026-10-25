import { z } from 'zod';

import { TargetingDimension } from '@src/types';
import { opaqueIds, windows } from '../families';
import { dimension, DimensionDescriptor, listsOf } from './descriptor';

/** How many hints the LLM platforms take: a handful of themes, not a keyword list. */
const MAX_CONTEXT_HINTS = 100;

/** How many key-value pairs one criterion carries. */
const MAX_KEY_VALUE_PAIRS = 500;

/** How a product is matched when the Products mode is on. */
const productMatchSchema = z.enum(['exact', 'similar', 'complements', 'substitutes', 'remarketing']);

/**
 * A key-value pass-through.
 *
 * A flat list of pairs, each a key and the values it accepts: the values of one pair are **ORed**,
 * the pairs are **ANDed**, and `exclude` flips one pair. MBP nests boolean trees here; no platform of
 * the matrix takes one, so the model does not carry what it could not push
 * (`docs/phase-5.md` § 2).
 */
const keyValueSchema = z.strictObject({
  pairs: z
    .array(
      z.strictObject({
        key: z.string().trim().min(1).max(120),
        values: z.array(z.string().trim().min(1).max(256)).min(1).max(MAX_KEY_VALUE_PAIRS),
        exclude: z.boolean().default(false),
      })
    )
    .min(1)
    .max(MAX_KEY_VALUE_PAIRS),
});

/** When delivery happens, what it passes through, and what the Search levers add. */
export const DELIVERY_DIMENSIONS = {
  schedule: dimension('Plages horaires', 'windows', windows()),
  context_hints: dimension(
    'Thèmes de contexte',
    'shape',
    z.strictObject({
      hints: z.array(z.string().trim().min(1).max(80)).min(1).max(MAX_CONTEXT_HINTS),
    })
  ),
  product: dimension(
    'Produits',
    'shape',
    z
      .strictObject({
        include: z
          .array(z.strictObject({ id: z.string().trim().min(1).max(64), match: productMatchSchema }))
          .max(MAX_KEY_VALUE_PAIRS)
          .default([]),
        exclude: z.array(z.string().trim().min(1).max(64)).max(MAX_KEY_VALUE_PAIRS).default([]),
      })
      .refine(
        (criteria): boolean => criteria.include.length > 0 || criteria.exclude.length > 0,
        'a product criterion must include or exclude something'
      )
  ),
  product_category: dimension('Catégories de produits', 'opaque_ids', opaqueIds()),
  key_value: dimension('Clés-valeurs', 'shape', keyValueSchema),
  negative_keyword_lists: listsOf('Listes de mots-clés négatifs', 'negative_keyword'),
} satisfies Partial<Record<TargetingDimension, DimensionDescriptor>>;
