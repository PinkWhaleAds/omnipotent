import { PlatformProjection } from '@src/platforms/platform-rules';
import {
  countByObject,
  isBelow,
  keywordKey,
  objectKey,
  ProjectedObject,
  ProjectionNode,
  projectObjects,
  splitKey,
} from '@src/platforms/projection';

/**
 * What Google Ads and Microsoft do with our tree, which multi-search proves: our AdGroup is a
 * campaign and holds the budget, our TargetingGroup is one of its ad groups, our Line is an ad, and
 * neither our campaign nor our lever becomes anything of its own.
 */
const SEARCH_SHAPE: PlatformProjection = {
  levels: { campaign: null, lever: null, ad_group: 'campaign', targeting_group: 'ad_group', line: 'ad' },
  budgetLevel: 'ad_group',
};

/**
 * What a DSP does with it: our campaign becomes a mediaplan which holds the budget, our AdGroup an
 * order, our TargetingGroup a line item, our Line a creative. Deliberately different from
 * {@link SEARCH_SHAPE} at every point the engine could be tempted to assume one of them.
 */
const DSP_SHAPE: PlatformProjection = {
  levels: {
    campaign: 'media_plan',
    lever: null,
    ad_group: 'order',
    targeting_group: 'line_item',
    line: 'creative',
  },
  budgetLevel: 'campaign',
};

/**
 * A branch of our tree, as the projection reads it.
 *
 * @param overrides - What this case declares
 * @returns The campaign node, with a lever, an AdGroup, a TargetingGroup and a Line
 */
function branch(overrides: { targetingGroupBudget?: number | null; keywordIds?: string[] } = {}): ProjectionNode {
  return {
    level: 'campaign',
    id: 'c1',
    budgetCents: 100_000,
    children: [
      {
        level: 'lever',
        id: 'v1',
        budgetCents: null,
        children: [
          {
            level: 'ad_group',
            id: 'g1',
            budgetCents: null,
            children: [
              {
                level: 'targeting_group',
                id: 't1',
                budgetCents: overrides.targetingGroupBudget ?? null,
                keywordIds: overrides.keywordIds ?? [],
                children: [{ level: 'line', id: 'l1', budgetCents: null, children: [] }],
              },
            ],
          },
        ],
      },
    ],
  };
}

/** The keys of a projection, in the order it emitted them. */
function keys(objects: readonly ProjectedObject[]): string[] {
  return objects.map((object: ProjectedObject): string => object.key);
}

describe('Unit::Platforms::Projection', () => {
  describe('isBelow', () => {
    it('should order the five levels from the root down', (): void => {
      expect(isBelow('targeting_group', 'ad_group')).toBe(true);
      expect(isBelow('line', 'campaign')).toBe(true);
      expect(isBelow('ad_group', 'targeting_group')).toBe(false);
      // A level is not below itself: that is what stops a node holding a budget at the very level
      // the platform holds one from splitting against itself.
      expect(isBelow('ad_group', 'ad_group')).toBe(false);
    });
  });

  describe('keys', () => {
    it('should name an object by its level and its node', (): void => {
      expect(objectKey('line', 'l1')).toBe('line:l1');
      expect(splitKey('targeting_group', 't1')).toBe('split:targeting_group:t1');
      expect(keywordKey('k1')).toBe('keyword:k1');
    });
  });

  describe('projectObjects', () => {
    it('should skip the levels the platform materializes nothing for, and close the tree over them', (): void => {
      const objects: ProjectedObject[] = projectObjects(SEARCH_SHAPE, branch());

      // Neither our campaign nor our lever exists at Google: the AdGroup's campaign is the root.
      expect(keys(objects)).toEqual(['ad_group:g1', 'targeting_group:t1', 'line:l1']);
      expect(objects[0]).toEqual({
        key: 'ad_group:g1',
        level: 'ad_group',
        nodeId: 'g1',
        keywordId: null,
        object: 'campaign',
        parentKey: null,
        split: false,
      });
      expect(objects[1].parentKey).toBe('ad_group:g1');
      expect(objects[2].parentKey).toBe('targeting_group:t1');
    });

    it('should project the same tree differently for a DSP, without a word of code per platform', (): void => {
      const objects: ProjectedObject[] = projectObjects(DSP_SHAPE, branch());

      expect(keys(objects)).toEqual(['campaign:c1', 'ad_group:g1', 'targeting_group:t1', 'line:l1']);
      expect(objects.map((object: ProjectedObject): string => object.object)).toEqual([
        'media_plan',
        'order',
        'line_item',
        'creative',
      ]);
      // The lever became nothing, so the order hangs straight from the mediaplan.
      expect(objects[1].parentKey).toBe('campaign:c1');
    });

    it('should give a node below the budget level, carrying a budget, its own object of that level', (): void => {
      const objects: ProjectedObject[] = projectObjects(SEARCH_SHAPE, branch({ targetingGroupBudget: 30_000 }));

      // The split of `CADRAGE.md` § 7: a second Google campaign, and the ad group hangs from it
      // rather than from the AdGroup's own campaign.
      expect(keys(objects)).toEqual(['ad_group:g1', 'split:targeting_group:t1', 'targeting_group:t1', 'line:l1']);
      expect(objects[1]).toMatchObject({ level: 'ad_group', nodeId: 't1', object: 'campaign', split: true });
      expect(objects[1].parentKey).toBe('ad_group:g1');
      expect(objects[2].parentKey).toBe('split:targeting_group:t1');
    });

    it('should split the same budget at the level the DSP holds one, which is another level', (): void => {
      const objects: ProjectedObject[] = projectObjects(DSP_SHAPE, branch({ targetingGroupBudget: 30_000 }));

      // There the budget sits on the mediaplan, so the TargetingGroup becomes its own mediaplan.
      expect(objects[2]).toMatchObject({
        key: 'split:targeting_group:t1',
        level: 'campaign',
        object: 'media_plan',
        split: true,
      });
      expect(objects[3].parentKey).toBe('split:targeting_group:t1');
    });

    it('should not split a node whose own level the platform materializes nothing for', (): void => {
      const shape: PlatformProjection = {
        levels: { ...SEARCH_SHAPE.levels, targeting_group: null },
        budgetLevel: 'ad_group',
      };

      const objects: ProjectedObject[] = projectObjects(shape, branch({ targetingGroupBudget: 30_000 }));

      // A node that becomes nothing has nothing to re-parent: splitting would create an orphan
      // campaign holding a budget no ad group spends.
      expect(keys(objects)).toEqual(['ad_group:g1', 'line:l1']);
      expect(objects[1].parentKey).toBe('ad_group:g1');
    });

    it('should hang a keyword from the node that carries it', (): void => {
      const objects: ProjectedObject[] = projectObjects(SEARCH_SHAPE, branch({ keywordIds: ['k1', 'k2'] }));

      expect(keys(objects)).toEqual(['ad_group:g1', 'targeting_group:t1', 'keyword:k1', 'keyword:k2', 'line:l1']);
      expect(objects[2]).toEqual({
        key: 'keyword:k1',
        level: 'targeting_group',
        nodeId: 't1',
        keywordId: 'k1',
        object: 'keyword',
        parentKey: 'targeting_group:t1',
        split: false,
      });
    });

    it('should emit parents before children, so an adapter never looks ahead', (): void => {
      const objects: ProjectedObject[] = projectObjects(DSP_SHAPE, branch({ targetingGroupBudget: 1 }));
      const seen = new Set<string>();

      for (const object of objects) {
        if (object.parentKey !== null) expect(seen.has(object.parentKey)).toBe(true);
        seen.add(object.key);
      }
    });
  });

  describe('countByObject', () => {
    it('should count what will exist, in the words of the platform', (): void => {
      expect(countByObject(projectObjects(SEARCH_SHAPE, branch({ keywordIds: ['k1'] })))).toEqual({
        campaign: 1,
        ad_group: 1,
        keyword: 1,
        ad: 1,
      });
    });

    it('should count the objects the split added', (): void => {
      expect(countByObject(projectObjects(SEARCH_SHAPE, branch({ targetingGroupBudget: 30_000 })))).toEqual({
        campaign: 2,
        ad_group: 1,
        ad: 1,
      });
    });

    it('should answer nothing for a platform that materializes nothing', (): void => {
      const shape: PlatformProjection = {
        levels: { campaign: null, lever: null, ad_group: null, targeting_group: null, line: null },
        budgetLevel: 'ad_group',
      };

      expect(countByObject(projectObjects(shape, branch({ targetingGroupBudget: 1 })))).toEqual({});
    });
  });
});
