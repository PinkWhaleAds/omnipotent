/**
 * @module platforms/projection
 *
 * What a platform makes of our tree, **deduced** from the declaration of the registry
 * (`../../CADRAGE.md` § 7).
 *
 * Pure, and the single source of the deduction: the preview counts the objects from it and the sync
 * engine builds the desired state from it, so the two can never disagree about what will exist over
 * there. An adapter implements nothing for either to work.
 */
import { PlatformProjection } from './platform-rules';
import { PlatformObject, TreeLevel, treeLevelSchema } from '@src/types';

/** The five levels, from the root down: the order the walk and the split rule need. */
const LEVELS: readonly TreeLevel[] = treeLevelSchema.options;

/**
 * One node of our tree, as the projection reads it.
 *
 * Deliberately structural and minimal: the projection needs the shape of the tree and the one field
 * that changes it — an explicit budget — never the rest of a node. The services map their entities
 * into it, which is also what lets a test describe a tree in a few lines.
 *
 * @property level - Its level
 * @property id - Its id
 * @property budgetCents - Its **own** budget, `null` when it inherits (`services/budget.helpers.ts`)
 * @property keywordIds - Ids of the keywords hanging from it, for the levels that have them
 * @property children - The nodes below it, in order; empty at the leaf
 */
export type ProjectionNode = {
  level: TreeLevel;
  id: string;
  budgetCents: number | null;
  keywordIds?: readonly string[];
  children: readonly ProjectionNode[];
};

/**
 * One object a platform will hold, as the projection deduces it.
 *
 * @property key - How both sides name it: `<level>:<nodeId>`, `split:<level>:<nodeId>` for an object
 *   the split added, `keyword:<id>` for a keyword
 * @property level - The level of ours it comes from
 * @property nodeId - The node of ours it comes from; for a keyword, the node it hangs from
 * @property keywordId - The keyword it **is**, `null` for every other object
 * @property object - What it is in the platform's own words
 * @property parentKey - The object above it over there, `null` for the root one
 * @property split - Whether the split of `../../CADRAGE.md` § 7 is what created it
 */
export type ProjectedObject = {
  key: string;
  level: TreeLevel;
  nodeId: string;
  keywordId: string | null;
  object: PlatformObject;
  parentKey: string | null;
  split: boolean;
};

/**
 * Whether a level sits strictly below another.
 *
 * @param level - The level asked about
 * @param other - The level it is compared to
 * @returns `true` when `level` is deeper than `other`
 *
 * @example
 * ```typescript
 * isBelow('targeting_group', 'ad_group'); // true
 * ```
 */
export function isBelow(level: TreeLevel, other: TreeLevel): boolean {
  return LEVELS.indexOf(level) > LEVELS.indexOf(other);
}

/**
 * The key of the object a node becomes.
 *
 * @param level - Its level
 * @param nodeId - Its id
 * @returns The key
 *
 * @example
 * ```typescript
 * objectKey('line', 'a3f…'); // 'line:a3f…'
 * ```
 */
export function objectKey(level: TreeLevel, nodeId: string): string {
  return `${level}:${nodeId}`;
}

/**
 * The key of the object the split adds for a node.
 *
 * @param level - The node's level
 * @param nodeId - Its id
 * @returns The key
 */
export function splitKey(level: TreeLevel, nodeId: string): string {
  return `split:${level}:${nodeId}`;
}

/**
 * The key of a keyword.
 *
 * @param keywordId - Its id
 * @returns The key
 */
export function keywordKey(keywordId: string): string {
  return `keyword:${keywordId}`;
}

/**
 * Everything a platform will hold for one branch of our tree, in creation order.
 *
 * Two rules, and they are the whole module:
 *
 * - a node becomes an object when the projection gives its level one, and hangs from the **nearest
 *   ancestor that became one** — a level the platform does not materialize simply disappears, and the
 *   tree closes over it;
 * - a node **strictly below** the level that holds the budget, carrying a budget of its own, has
 *   nowhere to put it: the split gives it its own object of the budget-holding level, and its own
 *   object hangs from that one instead. This is what makes a budget per point of interest possible
 *   everywhere, Search included.
 *
 * Parents come before children, so an adapter can create the list in order and never needs to look
 * ahead.
 *
 * @param projection - What the platform makes of our levels
 * @param root - The node to project, with its subtree
 * @returns The objects, parents first
 *
 * @example
 * ```typescript
 * projectObjects(projectionOf('google_ads', 'search'), campaignNode);
 * ```
 */
export function projectObjects(projection: PlatformProjection, root: ProjectionNode): ProjectedObject[] {
  const objects: ProjectedObject[] = [];
  const budgetObject: PlatformObject | null = projection.levels[projection.budgetLevel];

  /**
   * Project one node, then its children.
   *
   * @param node - The node
   * @param parentKey - The object its own object hangs from
   * @returns Nothing
   */
  const walk: (node: ProjectionNode, parentKey: string | null) => void = (
    node: ProjectionNode,
    parentKey: string | null
  ): void => {
    let parent: string | null = parentKey;
    // The split, deduced: a budget below the level that can hold one needs an object of that level.
    if (
      budgetObject !== null &&
      node.budgetCents !== null &&
      isBelow(node.level, projection.budgetLevel) &&
      projection.levels[node.level] !== null
    ) {
      const key: string = splitKey(node.level, node.id);
      objects.push({
        key,
        level: projection.budgetLevel,
        nodeId: node.id,
        keywordId: null,
        object: budgetObject,
        parentKey: parent,
        split: true,
      });
      parent = key;
    }

    const object: PlatformObject | null = projection.levels[node.level];
    const ownKey: string | null = object === null ? null : objectKey(node.level, node.id);
    if (object !== null && ownKey !== null) {
      objects.push({
        key: ownKey,
        level: node.level,
        nodeId: node.id,
        keywordId: null,
        object,
        parentKey: parent,
        split: false,
      });
      for (const keywordId of node.keywordIds ?? []) {
        objects.push({
          key: keywordKey(keywordId),
          level: node.level,
          nodeId: node.id,
          keywordId,
          object: 'keyword',
          parentKey: ownKey,
          split: false,
        });
      }
    }

    for (const child of node.children) walk(child, ownKey ?? parent);
  };

  walk(root, null);
  return objects;
}

/**
 * How many objects of each kind a branch produces.
 *
 * @param objects - What {@link projectObjects} deduced
 * @returns The count per object of the platform's vocabulary
 *
 * @example
 * ```typescript
 * countByObject(projectObjects(projection, node)); // { campaign: 3, ad_group: 5, ad: 5 }
 * ```
 */
export function countByObject(objects: readonly ProjectedObject[]): Partial<Record<PlatformObject, number>> {
  const counts: Partial<Record<PlatformObject, number>> = {};
  for (const object of objects) counts[object.object] = (counts[object.object] ?? 0) + 1;
  return counts;
}
