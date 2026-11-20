/**
 * @module platforms/desired-state
 *
 * The **desired state** of one unit, and its fingerprint — a pure function, which is the whole point.
 *
 * The engine never pushes modifications: it computes what must be true over there, hashes it, and
 * calls the adapter only when the hash differs from the last one applied
 * (`../../CADRAGE.md` § 14). Two properties follow, and they are the two that matter:
 *
 * - **nothing changed ⇒ no call at all.** The hash is equal and the unit is skipped;
 * - **one thing changed ⇒ one call.** The adapter receives the whole state and what it already
 *   created, and sends only the difference.
 *
 * Being pure, it also means a worker dying costs nothing: the state is recomputed from the database,
 * never held in memory.
 */
import { createHash } from 'node:crypto';

import {
  AssetRole,
  BidStrategy,
  Capping,
  CreativeFormat,
  CreativeSubtype,
  Extensions,
  LocationIntent,
  MatchType,
  Lever,
  NodeStatus,
  Platform,
  Targeting,
  Tracker,
  TreeLevel,
} from '@src/types';
import { PlatformProjection } from './platform-rules';
import { ProjectedObject, ProjectionNode, projectObjects } from './projection';

/** Micros in one cent: platforms count budgets and bids in millionths of a currency unit. */
export const MICROS_PER_CENT = 10_000;

/**
 * One keyword, as a platform receives it.
 *
 * @property id - Our id, which keys it in the unit's map
 * @property text - The term
 * @property matchType - How broadly it matches
 * @property negative - Whether it excludes instead of targeting
 */
export type DesiredKeyword = {
  id: string;
  text: string;
  matchType: MatchType;
  negative: boolean;
};

/**
 * One file a creative shows — a logo, an image —, described but never carried: its bytes are read
 * through the context, at the moment an adapter sends it (`PlatformContext.readAsset`).
 *
 * Its **fingerprint** is the content's own (SHA-256), so a new file is a new fingerprint and one call,
 * and an adapter finds a file it already sent by it.
 *
 * @property role - What it is for in the creative
 * @property id - Our asset
 * @property fingerprint - SHA-256 of its content
 * @property fileName - Its name, as uploaded
 * @property mimeType - Its type
 * @property width - Its width in pixels, `null` when it has none
 * @property height - Its height in pixels, `null` when it has none
 */
export type DesiredAsset = {
  role: AssetRole;
  id: string;
  fingerprint: string;
  fileName: string;
  mimeType: string;
  width: number | null;
  height: number | null;
};

/**
 * The creative a Line delivers, reduced to what a platform needs.
 *
 * It names the **version**, never the creative: a version is immutable (phase 6), so a new version is
 * a new fingerprint and therefore exactly one call.
 *
 * @property versionId - The version that delivers
 * @property format - The inventory it aims at
 * @property subtype - How it reaches the platform
 * @property payload - Its texts and settings, as the couple's schema validated them
 * @property assets - The files it shows, by role then id
 */
export type DesiredCreative = {
  versionId: string;
  format: CreativeFormat;
  subtype: CreativeSubtype;
  payload: Readonly<Record<string, unknown>>;
  assets: readonly DesiredAsset[];
};

/**
 * One node of our tree with everything a platform needs from it.
 *
 * @property level - Its level
 * @property id - Its id
 * @property name - What an interface shows over there
 * @property status - Its own status, before inheritance
 * @property startsOn - First day of delivery, resolved (`services/tree.helpers.ts`)
 * @property endsOn - Last day, resolved
 * @property budgetCents - Its **own** budget, `null` when it inherits: what drives the split
 * @property dailyBudgetCents - What its object must receive today, paced; `null` when it holds none
 * @property averageDailyCents - The planned average, sent instead while the object is paused
 * @property bidAmountCents - Its bid, `null` when it inherits one
 * @property bidStrategy - How it bids, `null` when it inherits: only the AdGroup carries one
 * @property capping - Its frequency caps, `null` when it inherits them
 * @property targeting - What it targets, `null` at a level that does not target
 * @property creative - The creative it delivers, `null` above the Line
 * @property landingPageUrl - Where a click goes: a Line's own page, else its creative's (L18)
 * @property trackers - Third-party trackers to attach
 * @property keywords - The keywords hanging from it
 * @property children - The nodes below it
 */
export type DesiredNode = {
  level: TreeLevel;
  id: string;
  name: string;
  status: NodeStatus;
  startsOn: string;
  endsOn: string;
  budgetCents: number | null;
  dailyBudgetCents: number | null;
  averageDailyCents: number | null;
  bidAmountCents: number | null;
  bidStrategy: BidStrategy | null;
  capping: Capping | null;
  targeting: Targeting | null;
  creative: DesiredCreative | null;
  landingPageUrl: string | null;
  trackers: readonly Tracker[] | null;
  keywords: readonly DesiredKeyword[];
  children: readonly DesiredNode[];
};

/**
 * One object a platform must hold, with what it must hold.
 *
 * The structure comes from `platforms/projection.ts`; this adds the values. A platform that holds no
 * budget at a level simply gets `null` there — the adapter never has to ask why.
 *
 * @property name - What an interface shows over there
 * @property status - Its effective status: `paused` as soon as it or anything above it is paused
 * @property startsOn - First day of delivery
 * @property endsOn - Last day
 * @property dailyBudgetMicros - Its budget today, in micros of the **account's** currency
 * @property bidMicros - Its bid, likewise
 * @property bidStrategy - How it bids, inherited from the nearest node above that says it; `null`
 *   above the AdGroup
 * @property capping - Its frequency caps
 * @property targeting - What it targets
 * @property creative - The creative it delivers
 * @property landingPageUrl - Where a click goes
 * @property trackers - Third-party trackers
 * @property keyword - The keyword it **is**, for an object of the `keyword` kind
 */
export type DesiredObject = ProjectedObject & {
  name: string;
  status: NodeStatus;
  startsOn: string;
  endsOn: string;
  dailyBudgetMicros: number | null;
  bidMicros: number | null;
  bidStrategy: BidStrategy | null;
  capping: Capping | null;
  targeting: Targeting | null;
  creative: DesiredCreative | null;
  landingPageUrl: string | null;
  trackers: readonly Tracker[] | null;
  keyword: DesiredKeyword | null;
};

/**
 * What one unit must be at its platform.
 *
 * @property unitId - Our unit, which an adapter tags its objects with to find them again
 * @property platform - The platform
 * @property lever - The lever the AdGroup buys on
 * @property adGroupId - The AdGroup this unit is the projection of
 * @property status - Its effective status: what the platform must end up showing for the unit as a
 *   whole, and what the engine compares the applied status against
 * @property campaignId - Our campaign
 * @property campaignName - Its name, which platforms show above everything
 * @property insertionOrderNumber - The commercial reference some platforms refuse to deliver without
 * @property containsPoliticalAdvertising - What the user declared (D53), which every platform of the
 *   scope must be told
 * @property settings - The settings of this platform on the lever, its defaults filled in
 * @property extensions - What every campaign of the unit shows around its ads, `null` for none
 * @property locationIntent - Who the places of the AdGroup reach
 * @property currency - The **account's** currency, which every amount here is in
 * @property timezone - The timezone the platform counts its days in
 * @property objects - Everything it must hold, parents first
 */
export type DesiredUnit = {
  unitId: string;
  platform: Platform;
  lever: Lever;
  adGroupId: string;
  status: NodeStatus;
  campaignId: string;
  campaignName: string;
  insertionOrderNumber: string | null;
  containsPoliticalAdvertising: boolean;
  settings: Readonly<Record<string, boolean>>;
  extensions: Extensions | null;
  locationIntent: LocationIntent;
  currency: string;
  timezone: string;
  objects: readonly DesiredObject[];
};

/**
 * What {@link desiredUnit} needs.
 *
 * @property unitId - Our unit
 * @property platform - The platform
 * @property lever - The lever
 * @property adGroupId - The AdGroup this unit is the projection of
 * @property projection - What the platform makes of our levels
 * @property campaign - The branch to project: our campaign, down to the Lines of this unit's AdGroup
 * @property insertionOrderNumber - Its commercial reference
 * @property containsPoliticalAdvertising - What the user declared about the campaign (D53)
 * @property settings - The settings of this platform on the lever, its defaults filled in
 * @property extensions - The extensions of the lever
 * @property locationIntent - Who the places of the AdGroup reach
 * @property currency - The account's currency
 * @property timezone - The account's timezone
 * @property fxRate - Units of the account currency for one of the campaign currency, frozen (D22)
 * @property live - Whether the campaign is `active`; anything else pauses every object
 * @property started - Whether its start time has come: before it, every object stays paused, since
 *   the time itself is never sent (`docs/phase-10.md` § 8.4, point 3)
 * @property today - Today, in the campaign's timezone (`YYYY-MM-DD`): what tells an object whose
 *   window has not started, or has ended, from one that delivers
 * @property minDailyBudgetCents - The platform's floor, in the account's currency: a platform refuses
 *   a budget below it **even on a paused object**, so a paused one sends the larger of this and the
 *   planned average
 */
export type DesiredInput = {
  unitId: string;
  platform: Platform;
  lever: Lever;
  adGroupId: string;
  projection: PlatformProjection;
  campaign: DesiredNode;
  insertionOrderNumber: string | null;
  containsPoliticalAdvertising: boolean;
  settings: Readonly<Record<string, boolean>>;
  extensions: Extensions | null;
  locationIntent: LocationIntent;
  currency: string;
  timezone: string;
  fxRate: number;
  live: boolean;
  started: boolean;
  today: string;
  minDailyBudgetCents: number;
};

/**
 * The SHA-256 fingerprint of a value.
 *
 * @param value - Anything serializable
 * @param length - How many hexadecimal characters to keep
 * @returns The fingerprint
 *
 * @example
 * ```typescript
 * fingerprint({ status: 'active' }, 16); // 'a3f1…'
 * ```
 */
export function fingerprint(value: unknown, length = 64): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, length);
}

/**
 * The structure of a tree of {@link DesiredNode}, as the projection reads it.
 *
 * @param node - The node
 * @returns The same tree, stripped of everything but what the projection needs
 */
export function structureOf(node: DesiredNode): ProjectionNode {
  return {
    level: node.level,
    id: node.id,
    budgetCents: node.budgetCents,
    keywordIds: node.keywords.map((keyword: DesiredKeyword): string => keyword.id),
    children: node.children.map(structureOf),
  };
}

/**
 * Convert an amount of the campaign's currency into micros of the account's.
 *
 * @param cents - The amount, in integer cents of the campaign currency
 * @param fxRate - The frozen rate
 * @returns Micros of the account currency
 */
export function toMicros(cents: number, fxRate: number): number {
  return Math.round(cents * fxRate) * MICROS_PER_CENT;
}

/**
 * Whether a node can deliver today at all.
 *
 * Three reasons it cannot, and none of them is a status someone set:
 *
 * - **its window has not started, or has ended** — a platform that received a start date in the past
 *   would deliver immediately, and one whose end has passed would keep going;
 * - **its budget of today is zero** — what the pacing answers once the planned total is spent, and
 *   what a platform either refuses or, worse, replaces with yesterday's amount;
 * - **its budget of today is under the platform's floor** — refused outright.
 *
 * Only the level that holds a budget over there is asked about money: the others carry none, and the
 * pause of the one above reaches them anyway.
 *
 * @param node - The node
 * @param input - What the state depends on
 * @param floorMicros - The platform's floor, in micros, never below one
 * @returns `true` when nothing stops it from delivering today
 */
function delivers(node: DesiredNode, input: DesiredInput, floorMicros: number): boolean {
  if (input.today < node.startsOn || input.today > node.endsOn) return false;
  if (node.dailyBudgetCents === null) return true;
  return toMicros(node.dailyBudgetCents, input.fxRate) >= floorMicros;
}

/**
 * What one unit must be at its platform, and its fingerprint.
 *
 * The amounts sent are the **paced budget of today**, converted to the account's currency at the
 * frozen rate. A paused object sends the larger of the platform's floor and the planned average,
 * because a platform refuses a budget under its minimum even on something that is not delivering —
 * and sending a wrong number there would make the next resume start from it.
 *
 * @param input - What the state depends on
 * @returns The desired state and its fingerprint
 *
 * @example
 * ```typescript
 * const { desired, hash } = desiredUnit(input);
 * if (hash === unit.syncedHash) return; // nothing changed: no call
 * ```
 */
export function desiredUnit(input: DesiredInput): { desired: DesiredUnit; hash: string } {
  const projected: ProjectedObject[] = projectObjects(input.projection, structureOf(input.campaign));
  const nodes = new Map<string, { node: DesiredNode; paused: boolean; bidStrategy: BidStrategy | null }>();
  const keywords = new Map<string, DesiredKeyword>();
  const floorMicros: number = Math.max(1, input.minDailyBudgetCents * MICROS_PER_CENT);

  /**
   * Index the tree by node id, carrying down whether anything above is paused, and how it bids.
   *
   * @param node - The node
   * @param paused - Whether an ancestor is paused
   * @param inherited - The strategy of the nearest ancestor that says one
   * @returns Nothing
   */
  const index: (node: DesiredNode, paused: boolean, inherited: BidStrategy | null) => void = (
    node: DesiredNode,
    paused: boolean,
    inherited: BidStrategy | null
  ): void => {
    const own: boolean = paused || node.status === 'paused' || !delivers(node, input, floorMicros);
    const bidStrategy: BidStrategy | null = node.bidStrategy ?? inherited;
    nodes.set(node.id, { node, paused: own, bidStrategy });
    for (const keyword of node.keywords) keywords.set(keyword.id, keyword);
    for (const child of node.children) index(child, own, bidStrategy);
  };
  index(input.campaign, !input.live || !input.started, null);
  const objects: DesiredObject[] = projected.map((object: ProjectedObject): DesiredObject => {
    // Every projected object comes from a node of this very tree, so both lookups are total.
    const { node, paused, bidStrategy } = nodes.get(object.nodeId) as {
      node: DesiredNode;
      paused: boolean;
      bidStrategy: BidStrategy | null;
    };

    // A keyword is not a node: it carries only itself, and the node it hangs from gives it its status.
    if (object.keywordId !== null) {
      return {
        ...object,
        name: node.name,
        status: paused ? 'paused' : 'active',
        startsOn: node.startsOn,
        endsOn: node.endsOn,
        dailyBudgetMicros: null,
        bidMicros: null,
        bidStrategy: null,
        capping: null,
        targeting: null,
        creative: null,
        landingPageUrl: null,
        trackers: null,
        keyword: keywords.get(object.keywordId) as DesiredKeyword,
      };
    }

    const holdsBudget: boolean = object.level === input.projection.budgetLevel;
    const todayMicros: number = toMicros(node.dailyBudgetCents ?? 0, input.fxRate);
    const averageMicros: number = toMicros(node.averageDailyCents ?? 0, input.fxRate);
    return {
      ...object,
      name: node.name,
      status: paused ? 'paused' : 'active',
      startsOn: node.startsOn,
      endsOn: node.endsOn,
      dailyBudgetMicros: holdsBudget ? (paused ? Math.max(floorMicros, averageMicros) : todayMicros) : null,
      bidMicros: node.bidAmountCents === null ? null : toMicros(node.bidAmountCents, input.fxRate),
      bidStrategy,
      capping: node.capping,
      targeting: node.targeting,
      creative: node.creative,
      landingPageUrl: node.landingPageUrl,
      trackers: node.trackers,
      keyword: null,
    };
  });

  const desired: DesiredUnit = {
    unitId: input.unitId,
    platform: input.platform,
    lever: input.lever,
    adGroupId: input.adGroupId,
    status: nodes.get(input.adGroupId)?.paused === false ? 'active' : 'paused',
    campaignId: input.campaign.id,
    campaignName: input.campaign.name,
    insertionOrderNumber: input.insertionOrderNumber,
    containsPoliticalAdvertising: input.containsPoliticalAdvertising,
    settings: input.settings,
    extensions: input.extensions,
    locationIntent: input.locationIntent,
    currency: input.currency,
    timezone: input.timezone,
    objects,
  };
  return { desired, hash: fingerprint(desired) };
}
