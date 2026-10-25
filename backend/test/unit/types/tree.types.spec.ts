import { z } from 'zod';

import {
  createAdGroupBodySchema,
  createCampaignBodySchema,
  createLeverBodySchema,
  createLineBodySchema,
  createTargetingGroupBodySchema,
  nodeWriteFields,
  nodeWriteFieldsWithoutVolume,
  nodeWriteFieldsWithoutWindow,
} from '@src/types';

/**
 * The fields a node of the tree writes the same way at every level.
 *
 * They are **spread** into each body, which is what this suite watches: a spread of `undefined` is
 * silently empty in JavaScript, so an import cycle between the shapes of the tree and the values a
 * lever profile declares would not throw — it would hand out bodies missing half their fields, and
 * every budget written through them would be dropped without a word. The guard is cheap; the failure
 * is invisible.
 */
const SHARED_FIELDS: string[] = ['budgetCents', 'budgetVolume', 'startsOn', 'endsOn', 'capping'];

/**
 * The keys of a Zod object schema.
 *
 * @param schema - The schema
 * @returns Its field names
 */
function keysOf(schema: z.ZodObject): string[] {
  return Object.keys(schema.shape);
}

describe('Unit::Types::TreeTypes', () => {
  describe('the shared node fields', () => {
    it('should carry every field a level may write', (): void => {
      expect(Object.keys(nodeWriteFields).sort()).toEqual([...SHARED_FIELDS].sort());
    });

    it('should drop the volume entry where no bid CPM lives (L25)', (): void => {
      expect(Object.keys(nodeWriteFieldsWithoutVolume)).not.toContain('budgetVolume');
      expect(Object.keys(nodeWriteFieldsWithoutVolume).sort()).toEqual(
        ['budgetCents', 'startsOn', 'endsOn', 'capping'].sort()
      );
    });

    it('should drop the window where a level has none', (): void => {
      expect(Object.keys(nodeWriteFieldsWithoutWindow).sort()).toEqual(
        ['budgetCents', 'budgetVolume', 'capping'].sort()
      );
    });
  });

  describe('the bodies that spread them', () => {
    it('should give a Lever every shared field, plus its own', (): void => {
      const keys: string[] = keysOf(createLeverBodySchema);

      for (const field of SHARED_FIELDS) expect(keys).toContain(field);
      expect(keys).toContain('platformShares');
    });

    it('should give an AdGroup every shared field, plus its bidding', (): void => {
      const keys: string[] = keysOf(createAdGroupBodySchema);

      for (const field of SHARED_FIELDS) expect(keys).toContain(field);
      expect(keys).toContain('objective');
      expect(keys).toContain('bidStrategy');
    });

    it('should give a TargetingGroup no window: it is a targeting applied', (): void => {
      const keys: string[] = keysOf(createTargetingGroupBodySchema);

      expect(keys).toContain('budgetCents');
      expect(keys).toContain('budgetVolume');
      expect(keys).not.toContain('startsOn');
      expect(keys).not.toContain('endsOn');
    });

    it('should give a Line no volume entry: it has no bid to convert through', (): void => {
      const keys: string[] = keysOf(createLineBodySchema);

      expect(keys).toContain('budgetCents');
      expect(keys).toContain('startsOn');
      expect(keys).not.toContain('budgetVolume');
      expect(keys).toContain('landingPageUrl');
    });

    it('should make a Campaign ask for its budget and its window outright', (): void => {
      const keys: string[] = keysOf(createCampaignBodySchema);

      // Mandatory columns, not shared optional fields: a campaign is the amount the tree divides.
      expect(keys).toContain('budgetCents');
      expect(keys).toContain('startsOn');
      expect(keys).not.toContain('budgetVolume');
      expect(createCampaignBodySchema.safeParse({ name: 'Automne', currency: 'EUR' }).success).toBe(false);
    });
  });

  describe('the strictness of every input', () => {
    it('should refuse a field no body declares', (): void => {
      for (const schema of [
        createCampaignBodySchema,
        createLeverBodySchema,
        createAdGroupBodySchema,
        createTargetingGroupBodySchema,
        createLineBodySchema,
      ]) {
        const parsed: z.ZodSafeParseResult<unknown> = schema.safeParse({ nope: 1 });

        expect(parsed.success).toBe(false);
        expect(parsed.error?.issues.some((issue): boolean => issue.code === 'unrecognized_keys')).toBe(true);
      }
    });
  });
});
