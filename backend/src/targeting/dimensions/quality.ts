import { z } from 'zod';

import { TargetingDimension } from '@src/types';
import { opaqueIds, range } from '../families';
import { dimension, DimensionDescriptor } from './descriptor';

/** A share of the population or of the impressions, in percent. */
const PERCENT = { min: 1, max: 100, integer: true };

/** The verification vendors the market uses; their categories stay theirs. */
const verifierProviderSchema = z.enum(['ias', 'double_verify', 'adloox', 'moat', 'other']);

/** How wide a suitability setting opens the inventory. */
const suitabilityLevelSchema = z.enum(['expanded', 'standard', 'limited']);

/** At which quality delivery happens: viewability, brand safety, verification. */
export const QUALITY_DIMENSIONS = {
  viewability: dimension('Visibilité attendue', 'range', range(PERCENT)),
  brand_safety: dimension('Catégories sensibles', 'opaque_ids', opaqueIds()),
  brand_suitability: dimension(
    'Niveau d’adéquation de marque',
    'shape',
    z.strictObject({ level: suitabilityLevelSchema })
  ),
  verifier: dimension(
    'Vérificateur tiers',
    'shape',
    z.strictObject({
      provider: verifierProviderSchema,
      // The categories a vendor refuses are named in its own vocabulary: we carry them, the platform
      // judges them, and a category gone stale fails at the push (`docs/phase-5.md` § 6).
      categories: z.array(z.string().trim().min(1).max(256)).min(1).max(500),
    })
  ),
  ifa_sampling: dimension('Échantillonnage des identifiants', 'range', range(PERCENT)),
} satisfies Partial<Record<TargetingDimension, DimensionDescriptor>>;
