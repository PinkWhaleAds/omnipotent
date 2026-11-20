/**
 * @module platforms/google/google.apply
 *
 * Make Google Ads match the desired state of one unit (`docs/phase-10.md` § 8.5), transcribed from
 * the convergence of multi-search (`src/platforms/google/google.adapter.ts`, our code):
 *
 * - **find before creating**: each Google campaign by the id `refs` kept, else by the tag of its name
 *   — what an interrupted synchronization left behind;
 * - **read what is there, send only the difference**, in **one atomic `mutate`**: the pauses first,
 *   the activations last, so three active ads per ad group are never exceeded even for an instant;
 * - **never delete** (R5): what left our tree is paused. A negative keyword has no status and is
 *   removed, as is a device adjustment or the link of an asset — settings, not objects with a history;
 * - **the brand apart**, one call per kind: Google shows a business name and a logo to eligible
 *   advertisers only, and its refusal must not stop the rest;
 * - **read the status back** once done.
 */
import { DesiredAsset, DesiredObject, DesiredUnit } from '@src/platforms/desired-state';
import { ApplyResult, PlatformContext, PlatformError, UnitRefs } from '@src/platforms/platform-adapter';
import { GoogleAdsClient } from './google.client';
import {
  adGroupCpcBid,
  AdGroupSlot,
  adMatches,
  campaignBidding,
  campaignCriteria,
  CampaignSlot,
  campaignSlots,
  criterionKey,
  DesiredLink,
  desiredLinks,
  endDateTime,
  EU_POLITICAL_ADVERTISING,
  excludedDevices,
  geoTargetTypeSetting,
  googleMatchType,
  googleStatus,
  imageTag,
  keywordKey,
  lineOfAd,
  linkKey,
  MANAGED_FIELD_TYPES,
  nameTag,
  networkSettings,
  refusal,
  roundMicros,
  searchAd,
  startDateTime,
  taggedName,
  TempIds,
  wallClock,
} from './google.mapping';
import {
  GoogleAd,
  GoogleAdGroup,
  GoogleAdGroupAd,
  GoogleAdGroupBidModifier,
  GoogleAdGroupCriterion,
  GoogleAdsRow,
  GoogleAsset,
  GoogleCampaign,
  GoogleCampaignAsset,
  GoogleCampaignCriterion,
  GoogleMutateOperation,
  GoogleStatus,
} from './google.types';

/** The kinds of asset that carry the brand, sent apart from the rest. */
const BRAND_FIELD_TYPES: readonly string[] = ['BUSINESS_NAME', 'BUSINESS_LOGO', 'AD_IMAGE'];

/**
 * What one unit holds at Google, read before changing it.
 *
 * @property campaigns - Its campaigns, by resource name, with their budget's amount
 * @property criteria - The places and circles of each campaign
 * @property adGroups - The ad groups of each campaign
 * @property keywords - The keywords of each ad group
 * @property modifiers - The device adjustments of each ad group
 * @property ads - The ads of each ad group
 * @property links - The managed assets of each campaign, with what they show
 */
type GoogleState = {
  campaigns: Map<string, GoogleCampaign & { budgetMicros: string | undefined }>;
  criteria: Map<string, GoogleCampaignCriterion[]>;
  adGroups: Map<string, GoogleAdGroup[]>;
  keywords: Map<string, GoogleAdGroupCriterion[]>;
  modifiers: Map<string, GoogleAdGroupBidModifier[]>;
  ads: Map<string, GoogleAdGroupAd[]>;
  links: Map<string, { link: GoogleCampaignAsset; key: string }[]>;
};

/**
 * The operations of one `mutate`, in three tiers so they apply in a safe order, and which refs key
 * each creation answers.
 */
class Plan {
  /** Pauses: they go first, freeing a place among the active ads. */
  public readonly first: GoogleMutateOperation[] = [];

  /** Creations, changes and removals. */
  public readonly middle: GoogleMutateOperation[] = [];

  /** Activations: they go last. */
  public readonly last: GoogleMutateOperation[] = [];

  /** Which refs key a creation answers, by its operation. */
  public readonly answers = new Map<GoogleMutateOperation, string>();

  /**
   * Add a creation whose resource name `refs` keeps.
   *
   * @param operation - The creation
   * @param key - The refs key it answers
   * @returns Nothing
   */
  public create(operation: GoogleMutateOperation, key: string): void {
    this.middle.push(operation);
    this.answers.set(operation, key);
  }

  /**
   * Every operation, in order.
   *
   * @returns The operations
   */
  public operations(): GoogleMutateOperation[] {
    return [...this.first, ...this.middle, ...this.last];
  }
}

/**
 * Group rows by a key, keeping their order.
 *
 * @typeParam T - The value kept
 * @param rows - The rows
 * @param keyOf - The key of a row, `undefined` to skip it
 * @param valueOf - What is kept of a row
 * @returns The values by key
 */
function groupBy<T>(
  rows: GoogleAdsRow[],
  keyOf: (row: GoogleAdsRow) => string | undefined,
  valueOf: (row: GoogleAdsRow) => T
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key: string | undefined = keyOf(row);
    if (key !== undefined) grouped.set(key, [...(grouped.get(key) ?? []), valueOf(row)]);
  }
  return grouped;
}

/**
 * A list of resource names, as GAQL takes it.
 *
 * @param names - The names
 * @returns `'a', 'b'`
 */
function quoted(names: readonly string[]): string {
  return names.map((name: string): string => `'${name}'`).join(', ');
}

/**
 * Makes one unit match its desired state at Google.
 */
export class GoogleUnitSync {
  /**
   * @param client - The calls of the API
   * @param now - The clock
   */
  constructor(
    private readonly client: GoogleAdsClient,
    private readonly now: () => number
  ) {}

  /**
   * Make Google match the desired state, idempotently.
   *
   * @param context - The account
   * @param desired - What must be true over there
   * @param refs - What exists, as the engine last recorded it
   * @returns What exists now, and the status Google shows for the unit
   * @throws PlatformError
   */
  public async apply(context: PlatformContext, desired: DesiredUnit, refs: UnitRefs): Promise<ApplyResult> {
    const customerId: string = context.externalId;
    const slots: CampaignSlot[] = campaignSlots(desired);
    const kept: Record<string, string> = { ...refs };
    const found: Map<string, string> = await this.findCampaigns(context, desired, slots, kept);
    const wanted = new Set<string>(found.values());
    // A campaign no object of ours stands for any more — a split undone — is read too, to be paused.
    const stale: string[] = Object.values(refs).filter(
      (name: string): boolean => name.includes('/campaigns/') && !wanted.has(name)
    );
    const state: GoogleState = await this.readState(context, [...wanted, ...stale]);

    const plan = new Plan();
    const ids = new TempIds(customerId);
    for (const slot of slots) {
      const existing: string | undefined = found.get(slot.key);
      if (existing !== undefined && !state.campaigns.has(existing)) {
        throw refusal(
          `The Google campaign of ${slot.campaign.name} was removed outside Omnipotent`,
          'google_campaign_removed',
          { campaign: slot.campaign.name }
        );
      }
      this.planCampaign(plan, ids, desired, slot, existing, state, kept);
    }
    // ...and paused, never removed.
    for (const name of stale) {
      if (state.campaigns.get(name)?.status === 'ENABLED') {
        plan.first.push({
          campaignOperation: { update: { resourceName: name, status: 'PAUSED' }, updateMask: 'status' },
        });
      }
    }

    const operations: GoogleMutateOperation[] = plan.operations();
    if (operations.length > 0) {
      const results: string[] = await this.client.mutate(context.adAccountId, customerId, operations);
      operations.forEach((operation: GoogleMutateOperation, index: number): void => {
        const key: string | undefined = plan.answers.get(operation);
        if (key !== undefined) kept[key] = results[index];
      });
    }
    await this.applyBrand(context, slots, state, kept);
    return { refs: kept, appliedStatus: await this.appliedStatus(context, slots, kept) };
  }

  /**
   * The Google campaign of each slot: the one `refs` names, else the one whose name carries its tag.
   *
   * @param context - The account
   * @param desired - The desired state
   * @param slots - The campaigns it must hold
   * @param refs - What the engine recorded
   * @returns The resource name of each campaign that exists, by slot key
   * @throws PlatformError
   */
  private async findCampaigns(
    context: PlatformContext,
    desired: DesiredUnit,
    slots: readonly CampaignSlot[],
    refs: UnitRefs
  ): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    const tags = new Map<string, string>();
    for (const slot of slots) {
      const recorded: string | undefined = refs[slot.key];
      if (recorded !== undefined) found.set(slot.key, recorded);
      else tags.set(nameTag(desired.unitId, slot.key), slot.key);
    }
    if (tags.size === 0) return found;

    const hashes: string = [...tags.keys()].map((tag: string): string => tag.slice(4, -1)).join('|');
    const rows: GoogleAdsRow[] = await this.client.search(
      context.adAccountId,
      context.externalId,
      `SELECT campaign.resource_name, campaign.name FROM campaign WHERE campaign.name REGEXP_MATCH '.*op:(${hashes}).*' AND campaign.status != 'REMOVED'`
    );
    for (const row of rows) {
      const tag: string | undefined = [...tags.keys()].find((candidate: string): boolean =>
        (row.campaign?.name ?? '').includes(candidate)
      );
      if (tag !== undefined) found.set(tags.get(tag) as string, row.campaign?.resourceName as string);
    }
    return found;
  }

  /**
   * Read what the campaigns of the unit hold.
   *
   * @param context - The account
   * @param campaigns - Their resource names
   * @returns What they hold; empty when there is none yet
   * @throws PlatformError
   */
  private async readState(context: PlatformContext, campaigns: readonly string[]): Promise<GoogleState> {
    const state: GoogleState = {
      campaigns: new Map(),
      criteria: new Map(),
      adGroups: new Map(),
      keywords: new Map(),
      modifiers: new Map(),
      ads: new Map(),
      links: new Map(),
    };
    if (campaigns.length === 0) return state;
    const search = (query: string): Promise<GoogleAdsRow[]> =>
      this.client.search(context.adAccountId, context.externalId, query);
    const among: string = quoted(campaigns);

    for (const row of await search(
      'SELECT campaign.resource_name, campaign.name, campaign.status, campaign.campaign_budget, ' +
        'campaign_budget.amount_micros, campaign.bidding_strategy_type, campaign.target_spend.cpc_bid_ceiling_micros, ' +
        'campaign.network_settings.target_search_network, campaign.geo_target_type_setting.positive_geo_target_type, ' +
        'campaign.ai_max_setting.enable_ai_max, campaign.start_date_time, campaign.end_date_time ' +
        `FROM campaign WHERE campaign.resource_name IN (${among}) AND campaign.status != 'REMOVED'`
    )) {
      const campaign = row.campaign as GoogleCampaign;
      state.campaigns.set(campaign.resourceName as string, {
        ...campaign,
        budgetMicros: row.campaignBudget?.amountMicros,
      });
    }
    const alive: string = quoted([...state.campaigns.keys()]);
    if (alive === '') return state;

    state.criteria = groupBy(
      await search(
        'SELECT campaign_criterion.resource_name, campaign_criterion.campaign, campaign_criterion.negative, ' +
          'campaign_criterion.location.geo_target_constant, campaign_criterion.proximity.geo_point.latitude_in_micro_degrees, ' +
          'campaign_criterion.proximity.geo_point.longitude_in_micro_degrees, campaign_criterion.proximity.radius ' +
          `FROM campaign_criterion WHERE campaign_criterion.campaign IN (${alive}) AND campaign_criterion.type IN ('LOCATION', 'PROXIMITY')`
      ),
      (row: GoogleAdsRow) => row.campaignCriterion?.campaign,
      (row: GoogleAdsRow) => row.campaignCriterion as GoogleCampaignCriterion
    );
    state.adGroups = groupBy(
      await search(
        'SELECT ad_group.resource_name, ad_group.campaign, ad_group.name, ad_group.status, ad_group.cpc_bid_micros ' +
          `FROM ad_group WHERE ad_group.campaign IN (${alive}) AND ad_group.status != 'REMOVED'`
      ),
      (row: GoogleAdsRow) => row.adGroup?.campaign,
      (row: GoogleAdsRow) => row.adGroup as GoogleAdGroup
    );
    state.keywords = groupBy(
      await search(
        'SELECT ad_group_criterion.resource_name, ad_group_criterion.ad_group, ad_group_criterion.status, ' +
          'ad_group_criterion.negative, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type ' +
          `FROM ad_group_criterion WHERE campaign.resource_name IN (${alive}) AND ad_group_criterion.type = 'KEYWORD' ` +
          "AND ad_group_criterion.status != 'REMOVED'"
      ),
      (row: GoogleAdsRow) => row.adGroupCriterion?.adGroup,
      (row: GoogleAdsRow) => row.adGroupCriterion as GoogleAdGroupCriterion
    );
    state.modifiers = groupBy(
      await search(
        'SELECT ad_group_bid_modifier.resource_name, ad_group_bid_modifier.ad_group, ad_group_bid_modifier.device.type, ' +
          `ad_group_bid_modifier.bid_modifier FROM ad_group_bid_modifier WHERE campaign.resource_name IN (${alive})`
      ),
      // Google answers a row for every device of an ad group, with no modifier: only the exclusions we
      // set — a modifier of zero — are ours to keep or remove; the others cannot be removed at all.
      (row: GoogleAdsRow) => (row.adGroupBidModifier?.bidModifier === 0 ? row.adGroupBidModifier.adGroup : undefined),
      (row: GoogleAdsRow) => row.adGroupBidModifier as GoogleAdGroupBidModifier
    );
    state.ads = groupBy(
      await search(
        'SELECT ad_group_ad.resource_name, ad_group_ad.ad_group, ad_group_ad.status, ad_group_ad.ad.resource_name, ' +
          'ad_group_ad.ad.final_urls, ad_group_ad.ad.url_custom_parameters, ad_group_ad.ad.responsive_search_ad.headlines, ' +
          'ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.ad.responsive_search_ad.path1, ' +
          `ad_group_ad.ad.responsive_search_ad.path2 FROM ad_group_ad WHERE campaign.resource_name IN (${alive}) ` +
          "AND ad_group_ad.status != 'REMOVED'"
      ),
      (row: GoogleAdsRow) => row.adGroupAd?.adGroup,
      (row: GoogleAdsRow) => row.adGroupAd as GoogleAdGroupAd
    );
    state.links = groupBy(
      await search(
        'SELECT campaign_asset.resource_name, campaign_asset.campaign, campaign_asset.field_type, asset.resource_name, ' +
          'asset.name, asset.final_urls, asset.sitelink_asset.link_text, asset.sitelink_asset.description1, ' +
          'asset.sitelink_asset.description2, asset.callout_asset.callout_text, asset.structured_snippet_asset.header, ' +
          'asset.structured_snippet_asset.values, asset.text_asset.text FROM campaign_asset ' +
          `WHERE campaign_asset.campaign IN (${alive}) AND campaign_asset.status != 'REMOVED' ` +
          `AND campaign_asset.field_type IN (${quoted(MANAGED_FIELD_TYPES)})`
      ),
      (row: GoogleAdsRow) => row.campaignAsset?.campaign,
      (row: GoogleAdsRow) => ({
        link: row.campaignAsset as GoogleCampaignAsset,
        key: linkKey(
          row.campaignAsset?.fieldType as string,
          row.asset ?? {},
          /\[op:([0-9a-f]{16})\]/.exec(row.asset?.name ?? '')?.[1] ?? row.asset?.resourceName ?? null
        ),
      })
    );
    return state;
  }

  /**
   * Plan one Google campaign: created whole when it does not exist, its differences otherwise.
   *
   * @param plan - The operations so far
   * @param ids - The temporary names of this `mutate`
   * @param desired - The desired state
   * @param slot - The campaign
   * @param existing - Its resource name, when it exists
   * @param state - What exists
   * @param refs - What is kept, completed here
   * @returns Nothing
   */
  private planCampaign(
    plan: Plan,
    ids: TempIds,
    desired: DesiredUnit,
    slot: CampaignSlot,
    existing: string | undefined,
    state: GoogleState,
    refs: Record<string, string>
  ): void {
    const object: DesiredObject = slot.campaign;
    const now: number = this.now();
    const name: string = taggedName(`${desired.campaignName} — ${object.name}`, nameTag(desired.unitId, slot.key));
    // An object of the budget level always holds one: the desired state gives it today's, or its floor.
    const budgetMicros = String(roundMicros(object.dailyBudgetMicros as number, desired.currency));
    const bidMicros: number | null = object.bidMicros;
    const bidding: Pick<GoogleCampaign, 'manualCpc' | 'targetSpend'> = campaignBidding(
      object.bidStrategy,
      bidMicros,
      desired.currency
    );
    const settings: Pick<GoogleCampaign, 'networkSettings' | 'geoTargetTypeSetting' | 'aiMaxSetting'> = {
      networkSettings: networkSettings(desired.settings),
      geoTargetTypeSetting: geoTargetTypeSetting(desired.locationIntent),
      aiMaxSetting: { enableAiMax: desired.settings.aiMax === true },
    };
    const start: string | null = startDateTime(object.startsOn, desired.timezone, now);
    const end: string | null = endDateTime(object.endsOn, desired.timezone, now);
    const status: GoogleStatus = googleStatus(object.status);

    let campaign: string;
    if (existing === undefined) {
      const budget: string = ids.next('campaignBudgets');
      campaign = ids.next('campaigns');
      plan.middle.push({
        campaignBudgetOperation: {
          create: {
            resourceName: budget,
            name,
            amountMicros: budgetMicros,
            deliveryMethod: 'STANDARD',
            explicitlyShared: false,
          },
        },
      });
      plan.create(
        {
          campaignOperation: {
            create: {
              resourceName: campaign,
              name,
              status,
              advertisingChannelType: 'SEARCH',
              campaignBudget: budget,
              containsEuPoliticalAdvertising: EU_POLITICAL_ADVERTISING,
              ...settings,
              ...bidding,
              ...(start === null ? {} : { startDateTime: start }),
              ...(end === null ? {} : { endDateTime: end }),
            },
          },
        },
        slot.key
      );
    } else {
      campaign = existing;
      refs[slot.key] = existing;
      this.planCampaignChanges(plan, state, existing, {
        name,
        status,
        budgetMicros,
        bidding,
        settings,
        start,
        end,
        now: wallClock(now, desired.timezone),
      });
    }

    const current: GoogleCampaignCriterion[] = existing === undefined ? [] : (state.criteria.get(existing) ?? []);
    // The campaign's own node targets when it is a TargetingGroup; else its first ad group does, and
    // its siblings ask the same (`sharedTargeting`).
    const wanted: GoogleCampaignCriterion[] = campaignCriteria(
      object.targeting ?? slot.adGroups[0]?.adGroup.targeting ?? null,
      campaign
    );
    this.planSet(
      plan,
      current,
      wanted,
      criterionKey,
      (create: GoogleCampaignCriterion) => ({ campaignCriterionOperation: { create } }),
      (remove: string) => ({ campaignCriterionOperation: { remove } })
    );

    const groups: GoogleAdGroup[] = existing === undefined ? [] : (state.adGroups.get(existing) ?? []);
    const used = new Set<string>();
    for (const adGroup of slot.adGroups) {
      const found: string | undefined = this.planAdGroup(
        plan,
        ids,
        desired,
        adGroup,
        campaign,
        bidMicros,
        groups,
        state,
        refs
      );
      if (found !== undefined) used.add(found);
    }
    // An ad group no TargetingGroup stands for any more is paused.
    for (const group of groups) {
      if (!used.has(group.resourceName as string) && group.status === 'ENABLED') {
        plan.first.push(this.pause('adGroupOperation', group.resourceName as string));
      }
    }

    const lines: DesiredObject[] = slot.adGroups.flatMap((adGroup: AdGroupSlot): DesiredObject[] => adGroup.ads);
    const links: DesiredLink[] = desiredLinks(desired.extensions, lines).filter(
      (link: DesiredLink): boolean => !BRAND_FIELD_TYPES.includes(link.fieldType)
    );
    const linked: { link: GoogleCampaignAsset; key: string }[] = (
      existing === undefined ? [] : (state.links.get(existing) ?? [])
    ).filter(
      ({ link }: { link: GoogleCampaignAsset }): boolean => !BRAND_FIELD_TYPES.includes(link.fieldType as string)
    );
    for (const { link, key } of linked) {
      if (!links.some((wantedLink: DesiredLink): boolean => wantedLink.key === key)) {
        plan.middle.push({ campaignAssetOperation: { remove: link.resourceName as string } });
      }
    }
    for (const link of links) {
      if (linked.some(({ key }: { key: string }): boolean => key === link.key)) continue;
      const asset: string = ids.next('assets');
      plan.middle.push({ assetOperation: { create: { resourceName: asset, ...link.asset } } });
      plan.middle.push({ campaignAssetOperation: { create: { campaign, asset, fieldType: link.fieldType } } });
    }
  }

  /**
   * Plan what changes on a campaign that exists: only the fields that differ.
   *
   * @param plan - The operations so far
   * @param state - What exists
   * @param campaign - Its resource name
   * @param wanted - What it must be
   * @param wanted.name - Its name, tag included
   * @param wanted.status - Its status
   * @param wanted.budgetMicros - Its budget of today
   * @param wanted.bidding - How it bids
   * @param wanted.settings - Where it shows and whom its places reach
   * @param wanted.start - Its start, `null` once begun
   * @param wanted.end - Its end, `null` once passed
   * @param wanted.now - The wall clock of now in the account's timezone
   * @returns Nothing
   */
  private planCampaignChanges(
    plan: Plan,
    state: GoogleState,
    campaign: string,
    wanted: {
      name: string;
      status: GoogleStatus;
      budgetMicros: string;
      bidding: Pick<GoogleCampaign, 'manualCpc' | 'targetSpend'>;
      settings: Pick<GoogleCampaign, 'networkSettings' | 'geoTargetTypeSetting' | 'aiMaxSetting'>;
      start: string | null;
      end: string | null;
      now: string;
    }
  ): void {
    const current = state.campaigns.get(campaign) as GoogleCampaign & { budgetMicros: string | undefined };
    if (current.budgetMicros !== wanted.budgetMicros) {
      plan.middle.push({
        campaignBudgetOperation: {
          update: { resourceName: current.campaignBudget as string, amountMicros: wanted.budgetMicros },
          updateMask: 'amount_micros',
        },
      });
    }

    const update: GoogleCampaign = { resourceName: campaign };
    const mask: string[] = [];
    if (current.name !== wanted.name) {
      update.name = wanted.name;
      mask.push('name');
    }
    if (current.networkSettings?.targetSearchNetwork !== wanted.settings.networkSettings?.targetSearchNetwork) {
      update.networkSettings = wanted.settings.networkSettings;
      mask.push(
        'network_settings.target_google_search',
        'network_settings.target_search_network',
        'network_settings.target_content_network',
        'network_settings.target_partner_search_network'
      );
    }
    if (
      current.geoTargetTypeSetting?.positiveGeoTargetType !==
      wanted.settings.geoTargetTypeSetting?.positiveGeoTargetType
    ) {
      update.geoTargetTypeSetting = wanted.settings.geoTargetTypeSetting;
      mask.push('geo_target_type_setting.positive_geo_target_type', 'geo_target_type_setting.negative_geo_target_type');
    }
    if ((current.aiMaxSetting?.enableAiMax === true) !== wanted.settings.aiMaxSetting?.enableAiMax) {
      update.aiMaxSetting = wanted.settings.aiMaxSetting;
      mask.push('ai_max_setting.enable_ai_max');
    }
    if (wanted.bidding.manualCpc && current.biddingStrategyType !== 'MANUAL_CPC') {
      update.manualCpc = wanted.bidding.manualCpc;
      mask.push('manual_cpc.enhanced_cpc_enabled');
    }
    if (
      wanted.bidding.targetSpend &&
      (current.biddingStrategyType !== 'TARGET_SPEND' ||
        current.targetSpend?.cpcBidCeilingMicros !== wanted.bidding.targetSpend.cpcBidCeilingMicros)
    ) {
      update.targetSpend = wanted.bidding.targetSpend;
      mask.push('target_spend.cpc_bid_ceiling_micros');
    }
    // A start moves only while both the old one and the new one are to come.
    if (wanted.start !== null && current.startDateTime !== wanted.start && (current.startDateTime ?? '') > wanted.now) {
      update.startDateTime = wanted.start;
      mask.push('start_date_time');
    }
    if (wanted.end !== null && current.endDateTime !== wanted.end) {
      update.endDateTime = wanted.end;
      mask.push('end_date_time');
    }
    if (mask.length > 0) plan.middle.push({ campaignOperation: { update, updateMask: mask.join(',') } });
    this.planStatus(plan, 'campaignOperation', campaign, current.status as GoogleStatus, wanted.status);
  }

  /**
   * Plan one ad group: created when it does not exist, its differences otherwise, then its devices,
   * its keywords and its ads.
   *
   * @param plan - The operations so far
   * @param ids - The temporary names of this `mutate`
   * @param desired - The desired state
   * @param slot - The ad group
   * @param campaign - The resource name of its campaign
   * @param campaignBid - The bid of its campaign, which it bids when it has none of its own
   * @param groups - The ad groups that campaign holds
   * @param state - What exists
   * @param refs - What is kept, completed here
   * @returns The resource name of the ad group that existed, `undefined` for a new one
   */
  private planAdGroup(
    plan: Plan,
    ids: TempIds,
    desired: DesiredUnit,
    slot: AdGroupSlot,
    campaign: string,
    campaignBid: number | null,
    groups: readonly GoogleAdGroup[],
    state: GoogleState,
    refs: Record<string, string>
  ): string | undefined {
    const object: DesiredObject = slot.adGroup;
    const tag: string = nameTag(desired.unitId, slot.key);
    const name: string = taggedName(object.name, tag);
    const status: GoogleStatus = googleStatus(object.status);
    const cpcBidMicros: string | undefined = adGroupCpcBid(
      object.bidStrategy,
      object.bidMicros ?? campaignBid,
      desired.currency
    );
    const current: GoogleAdGroup | undefined = groups.find(
      (group: GoogleAdGroup): boolean => group.resourceName === refs[slot.key] || (group.name ?? '').includes(tag)
    );

    let adGroup: string;
    if (current === undefined) {
      adGroup = ids.next('adGroups');
      plan.create(
        {
          adGroupOperation: {
            create: {
              resourceName: adGroup,
              campaign,
              name,
              status,
              type: 'SEARCH_STANDARD',
              ...(cpcBidMicros === undefined ? {} : { cpcBidMicros }),
            },
          },
        },
        slot.key
      );
    } else {
      adGroup = current.resourceName as string;
      refs[slot.key] = adGroup;
      const update: GoogleAdGroup = { resourceName: adGroup };
      const mask: string[] = [];
      if (current.name !== name) {
        update.name = name;
        mask.push('name');
      }
      if (cpcBidMicros !== undefined && current.cpcBidMicros !== cpcBidMicros) {
        update.cpcBidMicros = cpcBidMicros;
        mask.push('cpc_bid_micros');
      }
      if (mask.length > 0) plan.middle.push({ adGroupOperation: { update, updateMask: mask.join(',') } });
      this.planStatus(plan, 'adGroupOperation', adGroup, current.status as GoogleStatus, status);
    }

    this.planSet(
      plan,
      current === undefined ? [] : (state.modifiers.get(adGroup) ?? []),
      excludedDevices(object.targeting).map((type: string): GoogleAdGroupBidModifier => ({
        adGroup,
        device: { type },
        bidModifier: 0,
      })),
      (modifier: GoogleAdGroupBidModifier): string => `${modifier.device?.type}:${Number(modifier.bidModifier)}`,
      (create: GoogleAdGroupBidModifier) => ({ adGroupBidModifierOperation: { create } }),
      (remove: string) => ({ adGroupBidModifierOperation: { remove } })
    );
    this.planKeywords(plan, slot, adGroup, current === undefined ? [] : (state.keywords.get(adGroup) ?? []), refs);
    this.planAds(plan, slot, adGroup, current === undefined ? [] : (state.ads.get(adGroup) ?? []), refs);
    return current?.resourceName;
  }

  /**
   * Plan the keywords of an ad group. A keyword is immutable: a changed one is a new criterion, and the
   * old one is paused — or removed when it is negative, which has no status.
   *
   * @param plan - The operations so far
   * @param slot - The ad group
   * @param adGroup - Its resource name
   * @param current - Its keywords over there
   * @param refs - What is kept, completed here
   * @returns Nothing
   */
  private planKeywords(
    plan: Plan,
    slot: AdGroupSlot,
    adGroup: string,
    current: readonly GoogleAdGroupCriterion[],
    refs: Record<string, string>
  ): void {
    const byKey = new Map<string, GoogleAdGroupCriterion>(
      current.map((criterion: GoogleAdGroupCriterion): [string, GoogleAdGroupCriterion] => [
        keywordKey(criterion.keyword?.text ?? '', criterion.keyword?.matchType ?? '', criterion.negative === true),
        criterion,
      ])
    );
    const wanted = new Set<string>();
    for (const object of slot.keywords) {
      const keyword = object.keyword as NonNullable<DesiredObject['keyword']>;
      const matchType: string = googleMatchType(keyword.matchType);
      const key: string = keywordKey(keyword.text, matchType, keyword.negative);
      if (wanted.has(key)) continue;
      wanted.add(key);
      const status: GoogleStatus = googleStatus(object.status);
      const existing: GoogleAdGroupCriterion | undefined = byKey.get(key);
      if (existing === undefined) {
        plan.create(
          {
            adGroupCriterionOperation: {
              create: {
                adGroup,
                ...(keyword.negative ? { negative: true } : { status }),
                keyword: { text: keyword.text, matchType },
              },
            },
          },
          object.key
        );
        continue;
      }
      refs[object.key] = existing.resourceName as string;
      if (!keyword.negative) {
        this.planStatus(
          plan,
          'adGroupCriterionOperation',
          existing.resourceName as string,
          existing.status as GoogleStatus,
          status
        );
      }
    }
    for (const [key, criterion] of byKey) {
      if (wanted.has(key)) continue;
      if (criterion.negative === true) {
        plan.middle.push({ adGroupCriterionOperation: { remove: criterion.resourceName as string } });
      } else if (criterion.status === 'ENABLED') {
        plan.first.push(this.pause('adGroupCriterionOperation', criterion.resourceName as string));
      }
    }
  }

  /**
   * Plan the ads of an ad group, one per Line, found by the `mskey` each carries.
   *
   * @param plan - The operations so far
   * @param slot - The ad group
   * @param adGroup - Its resource name
   * @param current - Its ads over there
   * @param refs - What is kept, completed here
   * @returns Nothing
   */
  private planAds(
    plan: Plan,
    slot: AdGroupSlot,
    adGroup: string,
    current: readonly GoogleAdGroupAd[],
    refs: Record<string, string>
  ): void {
    const lines = new Set<string>();
    for (const line of slot.ads) {
      lines.add(line.nodeId);
      // A paused Line still being written — no creative yet — has nothing to send, and sends nothing.
      if (line.creative === null && line.status === 'paused') continue;
      const ad: GoogleAd = searchAd(line);
      const status: GoogleStatus = googleStatus(line.status);
      const existing: GoogleAdGroupAd | undefined = current.find(
        (candidate: GoogleAdGroupAd): boolean => lineOfAd(candidate.ad) === line.nodeId
      );
      if (existing === undefined) {
        plan.create({ adGroupAdOperation: { create: { adGroup, status, ad } } }, line.key);
        continue;
      }
      refs[line.key] = existing.resourceName as string;
      if (!adMatches(existing.ad as GoogleAd, ad)) {
        plan.middle.push({
          adOperation: {
            update: { resourceName: existing.ad?.resourceName, ...ad },
            updateMask:
              'final_urls,url_custom_parameters,responsive_search_ad.headlines,responsive_search_ad.descriptions,' +
              'responsive_search_ad.path1,responsive_search_ad.path2',
          },
        });
      }
      this.planStatus(
        plan,
        'adGroupAdOperation',
        existing.resourceName as string,
        existing.status as GoogleStatus,
        status
      );
    }
    // An ad no Line stands for any more is paused, before any other is enabled.
    for (const ad of current) {
      if (!lines.has(lineOfAd(ad.ad) ?? '') && ad.status === 'ENABLED') {
        plan.first.push(this.pause('adGroupAdOperation', ad.resourceName as string));
      }
    }
  }

  /**
   * Plan a set of immutable children: create what is missing, remove what is no longer wanted.
   *
   * @typeParam T - The child
   * @param plan - The operations so far
   * @param current - What exists
   * @param wanted - What must exist
   * @param keyOf - What tells two of them apart
   * @param create - The creation of one
   * @param remove - The removal of one, by resource name
   * @returns Nothing
   */
  private planSet<T extends { resourceName?: string }>(
    plan: Plan,
    current: readonly T[],
    wanted: readonly T[],
    keyOf: (child: T) => string,
    create: (child: T) => GoogleMutateOperation,
    remove: (resourceName: string) => GoogleMutateOperation
  ): void {
    const present = new Set<string>(current.map(keyOf));
    const target = new Set<string>(wanted.map(keyOf));
    for (const child of current) if (!target.has(keyOf(child))) plan.middle.push(remove(child.resourceName as string));
    for (const child of wanted) if (!present.has(keyOf(child))) plan.middle.push(create(child));
  }

  /**
   * Plan a change of status: a pause goes first, an activation last.
   *
   * @param plan - The operations so far
   * @param kind - The operation of the resource
   * @param resourceName - The resource
   * @param current - Its status over there
   * @param wanted - The status it must have
   * @returns Nothing
   */
  private planStatus(
    plan: Plan,
    kind: 'campaignOperation' | 'adGroupOperation' | 'adGroupCriterionOperation' | 'adGroupAdOperation',
    resourceName: string,
    current: GoogleStatus,
    wanted: GoogleStatus
  ): void {
    if (current === wanted) return;
    if (wanted === 'PAUSED') plan.first.push(this.pause(kind, resourceName));
    else {
      plan.last.push({
        [kind]: { update: { resourceName, status: 'ENABLED' }, updateMask: 'status' },
      } as GoogleMutateOperation);
    }
  }

  /**
   * The pause of one resource.
   *
   * @param kind - The operation of the resource
   * @param resourceName - The resource
   * @returns The operation
   */
  private pause(
    kind: 'campaignOperation' | 'adGroupOperation' | 'adGroupCriterionOperation' | 'adGroupAdOperation',
    resourceName: string
  ): GoogleMutateOperation {
    return { [kind]: { update: { resourceName, status: 'PAUSED' }, updateMask: 'status' } } as GoogleMutateOperation;
  }

  /**
   * Link the brand to each campaign, one call per asset: a refusal that waiting cannot mend — Google
   * shows a business name and a logo to eligible advertisers only — is kept in `refs` so the asset is
   * never sent again, and the campaign goes without it.
   *
   * @param context - The account
   * @param slots - The campaigns
   * @param state - What existed before this call
   * @param refs - What is kept, completed here
   * @returns A promise that resolves once every brand asset was tried
   * @throws PlatformError when the refusal can be retried
   */
  private async applyBrand(
    context: PlatformContext,
    slots: readonly CampaignSlot[],
    state: GoogleState,
    refs: Record<string, string>
  ): Promise<void> {
    for (const slot of slots) {
      const campaign: string = refs[slot.key];
      const lines: DesiredObject[] = slot.adGroups.flatMap((adGroup: AdGroupSlot): DesiredObject[] => adGroup.ads);
      const linked: string[] = (state.links.get(campaign) ?? []).map(({ key }: { key: string }): string => key);
      for (const link of desiredLinks(null, lines)) {
        const refused = `brand:${link.key}`;
        if (linked.includes(link.key) || refs[refused] === '') continue;
        try {
          const asset: string = link.image
            ? await this.imageAsset(context, link.image, refs)
            : (
                await this.client.mutate(context.adAccountId, context.externalId, [
                  { assetOperation: { create: link.asset as GoogleAsset } },
                ])
              )[0];
          await this.client.mutate(context.adAccountId, context.externalId, [
            { campaignAssetOperation: { create: { campaign, asset, fieldType: link.fieldType } } },
          ]);
        } catch (error: unknown) {
          if (!(error instanceof PlatformError) || error.options.retryable || error.options.ownCredentials) throw error;
          refs[refused] = '';
        }
      }
    }
  }

  /**
   * The image asset of a file: the one `refs` names, else the one whose name carries its tag, else a
   * new upload.
   *
   * @param context - The account
   * @param image - The file
   * @param refs - What is kept, completed here
   * @returns Its resource name
   * @throws PlatformError
   */
  private async imageAsset(
    context: PlatformContext,
    image: DesiredAsset,
    refs: Record<string, string>
  ): Promise<string> {
    const key = `image:${image.fingerprint}`;
    if (refs[key]) return refs[key];
    const tag: string = imageTag(image);
    const rows: GoogleAdsRow[] = await this.client.search(
      context.adAccountId,
      context.externalId,
      `SELECT asset.resource_name FROM asset WHERE asset.type = 'IMAGE' AND asset.name LIKE '%${tag.slice(1, -1)}%'`
    );
    const found: string | undefined = rows[0]?.asset?.resourceName;
    refs[key] =
      found ??
      (
        await this.client.mutate(context.adAccountId, context.externalId, [
          {
            assetOperation: {
              create: {
                name: `${image.fileName.slice(0, 80)} ${tag}`,
                type: 'IMAGE',
                imageAsset: { data: (await context.readAsset(image.id)).toString('base64') },
              },
            },
          },
        ])
      )[0];
    return refs[key];
  }

  /**
   * The status Google shows for the unit, read back: `active` when one of its campaigns serves.
   *
   * @param context - The account
   * @param slots - Its campaigns
   * @param refs - What exists
   * @returns `active` or `paused`, `null` when it holds no campaign
   * @throws PlatformError
   */
  private async appliedStatus(
    context: PlatformContext,
    slots: readonly CampaignSlot[],
    refs: Record<string, string>
  ): Promise<string | null> {
    const campaigns: string[] = slots.map((slot: CampaignSlot): string => refs[slot.key]);
    if (campaigns.length === 0) return null;
    const rows: GoogleAdsRow[] = await this.client.search(
      context.adAccountId,
      context.externalId,
      `SELECT campaign.status FROM campaign WHERE campaign.resource_name IN (${quoted(campaigns)})`
    );
    return rows.some((row: GoogleAdsRow): boolean => row.campaign?.status === 'ENABLED') ? 'active' : 'paused';
  }
}
