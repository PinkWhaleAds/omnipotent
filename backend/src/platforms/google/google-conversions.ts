/**
 * @module platforms/google/google-conversions
 *
 * The conversions at Google Ads (D58, `docs/phase-10.md` § 8.10), transcribed from multi-search
 * (`src/platforms/google/google.adapter.ts` and `google.mapping.ts`, our code):
 *
 * - **the tracking code** of an account is its Google tag, `AW-<conversion tracking id>`, read in
 *   `customer.conversion_tracking_setting`. An account whose conversions a manager account tracks
 *   (cross-account tracking) waits for someone: our conversion actions are created in the account
 *   itself;
 * - **a goal** is a web page conversion action, **secondary** (`primaryForGoal: false`) so that no other
 *   campaign of the client starts bidding on it, and a **custom conversion goal** holding it alone,
 *   which our campaigns bid on. Both are found again by the tag of their name;
 * - **an archived goal is left where it is** (R5): Google has no pause for a conversion action, and the
 *   script no longer fires it, so it receives nothing. Measured again, it is found again with its label;
 * - **an account never tracked** has no conversion tracking id until its first conversion action exists —
 *   creating one turns the tracking on —: its tracking is ready without a tag, and the tag is read from
 *   the label of the goals meanwhile. To be seen on a real account (`docs/phase-10.md` § 8.10, point 6).
 */
import type { ConversionCategory } from '@src/types';
import type { AccountContext, GoalSpec, TrackingRefs, TrackingSetup } from '../platform-adapter';
import type { GoogleAdsClient } from './google.client';
import { nameTag, refusal, taggedName } from './google.mapping';
import type {
  GoogleAdsRow,
  GoogleCampaignConversionGoal,
  GoogleConversionAction,
  GoogleConversionGoalCampaignConfig,
  GoogleConversionTrackingSetting,
  GoogleCustomConversionGoal,
  GoogleMutateOperation,
  GoogleValueSettings,
} from './google.types';

/** Days after a click a conversion counts: 30, as on every platform. */
export const CLICK_LOOKBACK_DAYS = 30;

/** The longest name of a conversion action or a custom goal we write. */
const MAX_CONVERSION_NAME_LENGTH = 100;

/** Google `ConversionActionCategory` of each category. */
export const GOOGLE_CONVERSION_CATEGORIES: Readonly<Record<ConversionCategory, string>> = {
  purchase: 'PURCHASE',
  lead: 'SUBMIT_LEAD_FORM',
  signup: 'SIGNUP',
  subscription: 'SUBSCRIBE_PAID',
  trial: 'SIGNUP',
  appointment: 'BOOK_APPOINTMENT',
  contact: 'CONTACT',
  add_to_cart: 'ADD_TO_CART',
  begin_checkout: 'BEGIN_CHECKOUT',
  other: 'DEFAULT',
};

/** Fields of a conversion action read before an update. */
const CONVERSION_ACTION_FIELDS: readonly string[] = [
  'conversion_action.resource_name',
  'conversion_action.id',
  'conversion_action.name',
  'conversion_action.status',
  'conversion_action.category',
  'conversion_action.counting_type',
  'conversion_action.click_through_lookback_window_days',
  'conversion_action.primary_for_goal',
  'conversion_action.value_settings.default_value',
  'conversion_action.value_settings.default_currency_code',
  'conversion_action.value_settings.always_use_default_value',
  'conversion_action.tag_snippets',
];

/** Fields of a custom conversion goal read before an update. */
const CUSTOM_GOAL_FIELDS: readonly string[] = [
  'custom_conversion_goal.resource_name',
  'custom_conversion_goal.name',
  'custom_conversion_goal.conversion_actions',
  'custom_conversion_goal.status',
];

/** The GAQL queries of the conversions. */
export const CONVERSION_GAQL = {
  /** Where the conversions of the account queried are tracked, and the number of its Google tag. */
  tracking: (): string =>
    'SELECT customer.id, customer.conversion_tracking_setting.conversion_tracking_id, ' +
    'customer.conversion_tracking_setting.conversion_tracking_status, ' +
    'customer.conversion_tracking_setting.google_ads_conversion_customer FROM customer',
  /** A conversion action by its resource name, unless removed. */
  actionByName: (resourceName: string): string =>
    `SELECT ${CONVERSION_ACTION_FIELDS.join(', ')} FROM conversion_action ` +
    `WHERE conversion_action.resource_name = '${resourceName}' AND conversion_action.status != 'REMOVED'`,
  /** The conversion action of a goal, by the tag of its name (its brackets left out: `LIKE` reads them). */
  actionByTag: (tag: string): string =>
    `SELECT ${CONVERSION_ACTION_FIELDS.join(', ')} FROM conversion_action ` +
    `WHERE conversion_action.name LIKE '%${tag.slice(1, -1)}%' AND conversion_action.status != 'REMOVED'`,
  /** A custom conversion goal by its resource name, unless removed. */
  customGoalByName: (resourceName: string): string =>
    `SELECT ${CUSTOM_GOAL_FIELDS.join(', ')} FROM custom_conversion_goal ` +
    `WHERE custom_conversion_goal.resource_name = '${resourceName}' AND custom_conversion_goal.status != 'REMOVED'`,
  /** The custom conversion goal of a goal, by the tag of its name. */
  customGoalByTag: (tag: string): string =>
    `SELECT ${CUSTOM_GOAL_FIELDS.join(', ')} FROM custom_conversion_goal ` +
    `WHERE custom_conversion_goal.name LIKE '%${tag.slice(1, -1)}%' AND custom_conversion_goal.status != 'REMOVED'`,
  /** Which goals a campaign bids on. */
  goalConfig: (campaignId: string): string =>
    'SELECT campaign.id, conversion_goal_campaign_config.resource_name, ' +
    'conversion_goal_campaign_config.custom_conversion_goal, ' +
    'conversion_goal_campaign_config.goal_config_level FROM conversion_goal_campaign_config ' +
    `WHERE campaign.id = ${campaignId}`,
  /** The category × origin goals of a campaign, with whether it bids on each. */
  campaignGoals: (campaignId: string): string =>
    'SELECT campaign.id, campaign_conversion_goal.resource_name, campaign_conversion_goal.biddable ' +
    `FROM campaign_conversion_goal WHERE campaign.id = ${campaignId}`,
} as const;

/**
 * The tag of the conversion action of a goal.
 *
 * @param goalId - The goal
 * @returns `[op:<12 hexadecimal characters>]`
 */
export function actionTag(goalId: string): string {
  return nameTag(goalId, 'conversion_action');
}

/**
 * The tag of the custom conversion goal of a goal.
 *
 * @param goalId - The goal
 * @returns `[op:<12 hexadecimal characters>]`
 */
export function customGoalTag(goalId: string): string {
  return nameTag(goalId, 'custom_goal');
}

/**
 * The value of a goal's conversions: none (0, whatever the site sends), fixed, or sent by the site
 * with the default value as a fallback.
 *
 * @param goal - Value mode, default value and currency of the goal
 * @returns The value settings
 */
export function valueSettingsOf(
  goal: Pick<GoalSpec, 'valueMode' | 'defaultValueMicros' | 'currency'>
): GoogleValueSettings {
  if (goal.valueMode === 'none') return { defaultValue: 0, alwaysUseDefaultValue: true };
  return {
    defaultValue: (goal.defaultValueMicros ?? 0) / 1_000_000,
    ...(goal.currency ? { defaultCurrencyCode: goal.currency } : {}),
    alwaysUseDefaultValue: goal.valueMode === 'fixed',
  };
}

/**
 * The conversion action of a goal: a web page action counted from the Google tag, 30 days after a
 * click, **secondary** — a new primary action would join the goals every automated campaign of the
 * client's account bids on, ours or not. Our campaigns bid on it through a custom conversion goal, which
 * ignores `primaryForGoal`. The attribution is Google's default, data-driven.
 *
 * @param goal - The goal
 * @returns The action to create (without resource name)
 */
export function conversionActionFields(goal: GoalSpec): GoogleConversionAction {
  return {
    name: taggedName(goal.name, actionTag(goal.id), MAX_CONVERSION_NAME_LENGTH),
    type: 'WEBPAGE',
    category: GOOGLE_CONVERSION_CATEGORIES[goal.category],
    status: 'ENABLED',
    countingType: goal.counting === 'one' ? 'ONE_PER_CLICK' : 'MANY_PER_CLICK',
    valueSettings: valueSettingsOf(goal),
    clickThroughLookbackWindowDays: String(CLICK_LOOKBACK_DAYS),
    primaryForGoal: false,
  };
}

/** Fields of a conversion action compared one by one. */
const ACTION_FIELDS = [
  'name',
  'category',
  'status',
  'countingType',
  'clickThroughLookbackWindowDays',
  'primaryForGoal',
] as const;

/**
 * What to change on a goal's conversion action, only where it differs (fields at their default may be
 * missing from what Google answers). Settings changed outside Omnipotent are restored.
 *
 * @param action - The action at Google
 * @param goal - The goal
 * @returns The update (with its resource name) and its mask; an empty mask means nothing to send
 */
export function conversionActionChanges(
  action: GoogleConversionAction,
  goal: GoalSpec
): { update: GoogleConversionAction; mask: string[] } {
  const wanted: GoogleConversionAction = conversionActionFields(goal);
  const current: GoogleConversionAction = { primaryForGoal: false, ...action };
  const update: Record<string, unknown> = { resourceName: action.resourceName };
  const mask: string[] = [];
  for (const field of ACTION_FIELDS) {
    if (current[field] === wanted[field]) continue;
    update[field] = wanted[field];
    mask.push(field);
  }
  const value: GoogleValueSettings = { defaultValue: 0, alwaysUseDefaultValue: false, ...action.valueSettings };
  const target = wanted.valueSettings as GoogleValueSettings;
  const changed = (Object.keys(target) as (keyof GoogleValueSettings)[]).filter((key) => value[key] !== target[key]);
  if (changed.length > 0) {
    update.valueSettings = target;
    mask.push(...changed.map((key: string): string => `valueSettings.${key}`));
  }
  return { update: update as GoogleConversionAction, mask };
}

/** The `send_to` of an event snippet: `'send_to': 'AW-123/AbC-d_1'`. */
const SEND_TO = /['"]send_to['"]\s*:\s*['"](AW-[^'"\s]+)['"]/;

/**
 * Where the tracking script sends a goal's conversions: the `send_to` of the web page event snippet of
 * its conversion action.
 *
 * @param action - The action, read with its tag snippets
 * @returns `AW-<conversion tracking id>/<label>`, or `null` when Google gave no such snippet
 */
export function sendToOf(action: GoogleConversionAction | null | undefined): string | null {
  for (const snippet of action?.tagSnippets ?? []) {
    const match: RegExpExecArray | null = snippet.type === 'WEBPAGE' ? SEND_TO.exec(snippet.eventSnippet ?? '') : null;
    if (match) return match[1];
  }
  return null;
}

/**
 * The account a resource name points at.
 *
 * @param resourceName - `customers/5550001111`
 * @returns `5550001111`, or `null`
 */
function customerOfResource(resourceName: string | undefined): string | null {
  const match: RegExpExecArray | null = /^customers\/(\d+)$/.exec(resourceName ?? '');
  return match ? match[1] : null;
}

/**
 * The goal a campaign bids on, as the desired state hands it: the ids of the goal on the campaign's
 * account.
 *
 * @property conversionAction - Resource name of its conversion action
 * @property customGoal - Resource name of its custom conversion goal
 */
export type DesiredConversionGoal = { conversionAction: string | null; customGoal: string | null };

/**
 * The conversions of one client account: its Google tag, the conversion actions and custom goals of
 * its goals, and the goal a campaign bids on.
 */
export class GoogleConversions {
  /**
   * @param client - The calls of the API, through our manager account
   */
  constructor(private readonly client: GoogleAdsClient) {}

  /**
   * Where the conversions of the account are tracked, and its Google tag.
   *
   * @param account - The account
   * @param label - The account as Google Ads shows it (`555-000-1111`), in the messages
   * @returns `ready` with `{ tagId }` — `null` for an account not tracked yet —, `manual_required` under
   *   cross-account tracking (`google_conversion_tracking_by_our_manager`,
   *   `google_conversion_tracking_by_other_manager`, value `account`)
   * @throws PlatformError
   */
  public async setupTracking(account: AccountContext, label: string): Promise<TrackingSetup> {
    const [row] = await this.client.search(account.adAccountId, account.externalId, CONVERSION_GAQL.tracking());
    const setting: GoogleConversionTrackingSetting = row?.customer?.conversionTrackingSetting ?? {};
    const owner: string | null = customerOfResource(setting.googleAdsConversionCustomer);
    const waiting = (message: string, code: string): TrackingSetup => ({
      status: 'manual_required',
      refs: { tagId: null },
      message,
      messageCode: code,
      messageParams: { account: label },
      biddable: false,
    });
    if (setting.conversionTrackingStatus === 'CONVERSION_TRACKING_MANAGED_BY_THIS_MANAGER') {
      return waiting(
        `Conversions of the Google Ads account ${label} are tracked by our manager account (cross-account ` +
          'conversion tracking): an operator must turn it off for this account, since Omnipotent creates its ' +
          'conversion actions in the account itself',
        'google_conversion_tracking_by_our_manager'
      );
    }
    if (
      setting.conversionTrackingStatus === 'CONVERSION_TRACKING_MANAGED_BY_ANOTHER_MANAGER' ||
      (owner !== null && owner !== account.externalId)
    ) {
      return waiting(
        `Conversions of the Google Ads account ${label} are tracked by another manager account (cross-account ` +
          'conversion tracking), where Omnipotent cannot create conversion actions: that manager account must ' +
          "stop tracking this account's conversions (in its goal settings) first",
        'google_conversion_tracking_by_other_manager'
      );
    }
    const tagId: string | null = setting.conversionTrackingId ? `AW-${setting.conversionTrackingId}` : null;
    return { status: 'ready', refs: { tagId }, message: null, biddable: false };
  }

  /**
   * Create or update the conversion action of a goal (see {@link conversionActionFields}), and keep the
   * custom conversion goal our campaigns bid on it through. Each is found first by its recorded resource
   * name, then by the tag of its name. An archived goal is left where it is (R5).
   *
   * @param account - The account
   * @param goal - The goal
   * @param existing - Refs recorded at the last setup
   * @returns `ready` with `{ conversionAction, sendTo, customGoal }`, `paused` once archived, `failed` when
   *   Google gives no event snippet (`google_conversion_snippet_missing`)
   * @throws PlatformError
   */
  public async setupGoal(
    account: AccountContext,
    goal: GoalSpec,
    existing: TrackingRefs | null
  ): Promise<TrackingSetup> {
    let action: GoogleConversionAction | null = await this.findAction(
      account,
      goal.id,
      existing?.conversionAction ?? null
    );
    if (goal.status === 'archived') {
      return {
        status: 'paused',
        refs: {
          conversionAction: action?.resourceName ?? null,
          sendTo: sendToOf(action),
          customGoal: existing?.customGoal ?? null,
        },
        message: null,
        biddable: false,
      };
    }
    if (action) {
      const changes = conversionActionChanges(action, goal);
      if (changes.mask.length > 0) {
        await this.mutate(account, [
          { conversionActionOperation: { update: changes.update, updateMask: changes.mask.join(',') } },
        ]);
      }
    } else {
      const [created] = await this.mutate(account, [
        { conversionActionOperation: { create: conversionActionFields(goal) } },
      ]);
      // Google writes the tag snippets of a new action: read it again.
      action = (await this.findAction(account, goal.id, created)) ?? { resourceName: created };
    }
    const resourceName = action.resourceName as string;
    const sendTo: string | null = sendToOf(action);
    if (sendTo === null) {
      return {
        status: 'failed',
        refs: { conversionAction: resourceName, sendTo: null, customGoal: existing?.customGoal ?? null },
        message: `Google Ads gave no web page event snippet for the conversion action ${resourceName}`,
        messageCode: 'google_conversion_snippet_missing',
        messageParams: { conversionAction: resourceName },
        biddable: false,
      };
    }
    const customGoal: string = await this.customGoalOf(account, goal, resourceName, existing?.customGoal ?? null);
    return {
      status: 'ready',
      refs: { conversionAction: resourceName, sendTo, customGoal },
      message: null,
      biddable: true,
    };
  }

  /**
   * The changes that make a campaign bid on one goal only: its custom goal, and every category ×
   * origin goal of the campaign out of its bidding.
   *
   * @param account - The account
   * @param campaign - Resource name of the campaign, `customers/<id>/campaigns/<id>`
   * @param goal - The goal it bids on
   * @returns The operations to send, none when the campaign already bids on it alone
   * @throws PlatformError coded `google_conversion_goal_unavailable` for a goal without custom goal
   */
  public async goalOperations(
    account: AccountContext,
    campaign: string,
    goal: DesiredConversionGoal
  ): Promise<GoogleMutateOperation[]> {
    if (goal.customGoal === null) {
      throw refusal(
        'The conversion goal this campaign optimizes has no custom goal on this Google Ads account yet',
        'google_conversion_goal_unavailable'
      );
    }
    const campaignId: string = campaign.slice(campaign.lastIndexOf('/') + 1);
    const operations: GoogleMutateOperation[] = [];
    const [configRow] = await this.client.search(
      account.adAccountId,
      account.externalId,
      CONVERSION_GAQL.goalConfig(campaignId)
    );
    const config: GoogleConversionGoalCampaignConfig | undefined = configRow?.conversionGoalCampaignConfig;
    if (config?.customConversionGoal !== goal.customGoal) {
      operations.push({
        conversionGoalCampaignConfigOperation: {
          update: {
            resourceName: `customers/${account.externalId}/conversionGoalCampaignConfigs/${campaignId}`,
            customConversionGoal: goal.customGoal,
          },
          updateMask: 'customConversionGoal',
        },
      });
    }
    const goals: GoogleCampaignConversionGoal[] = (
      await this.client.search(account.adAccountId, account.externalId, CONVERSION_GAQL.campaignGoals(campaignId))
    ).flatMap((row: GoogleAdsRow): GoogleCampaignConversionGoal[] =>
      row.campaignConversionGoal ? [row.campaignConversionGoal] : []
    );
    for (const biddable of goals.filter((one: GoogleCampaignConversionGoal): boolean => one.biddable === true)) {
      operations.push({
        campaignConversionGoalOperation: {
          update: { resourceName: biddable.resourceName, biddable: false },
          updateMask: 'biddable',
        },
      });
    }
    return operations;
  }

  /**
   * The conversion action of a goal, not removed: by its recorded resource name, else by its tag.
   *
   * @param account - The account
   * @param goalId - The goal
   * @param recorded - Resource name recorded at the last setup, `null` for none
   * @returns The action, or `null`
   */
  private async findAction(
    account: AccountContext,
    goalId: string,
    recorded: string | null
  ): Promise<GoogleConversionAction | null> {
    if (recorded) {
      const [row] = await this.client.search(
        account.adAccountId,
        account.externalId,
        CONVERSION_GAQL.actionByName(recorded)
      );
      if (row?.conversionAction) return row.conversionAction;
    }
    const [row] = await this.client.search(
      account.adAccountId,
      account.externalId,
      CONVERSION_GAQL.actionByTag(actionTag(goalId))
    );
    return row?.conversionAction ?? null;
  }

  /**
   * The custom conversion goal of a goal, holding its conversion action only: found by its recorded
   * resource name, else by the tag of its name, kept up to date, or created.
   *
   * @param account - The account
   * @param goal - The goal
   * @param action - Resource name of its conversion action
   * @param recorded - Resource name recorded at the last setup, `null` for none
   * @returns Its resource name
   */
  private async customGoalOf(
    account: AccountContext,
    goal: GoalSpec,
    action: string,
    recorded: string | null
  ): Promise<string> {
    const tag: string = customGoalTag(goal.id);
    let found: GoogleCustomConversionGoal | undefined;
    if (recorded) {
      [found] = (
        await this.client.search(account.adAccountId, account.externalId, CONVERSION_GAQL.customGoalByName(recorded))
      ).flatMap((row: GoogleAdsRow): GoogleCustomConversionGoal[] =>
        row.customConversionGoal ? [row.customConversionGoal] : []
      );
    }
    found ??= (
      await this.client.search(account.adAccountId, account.externalId, CONVERSION_GAQL.customGoalByTag(tag))
    )[0]?.customConversionGoal;
    const name: string = taggedName(goal.name, tag, MAX_CONVERSION_NAME_LENGTH);
    if (!found) {
      const [created] = await this.mutate(account, [
        { customConversionGoalOperation: { create: { name, conversionActions: [action], status: 'ENABLED' } } },
      ]);
      return created;
    }
    const update: GoogleCustomConversionGoal = { resourceName: found.resourceName };
    const mask: string[] = [];
    if (found.name !== name) {
      update.name = name;
      mask.push('name');
    }
    if (JSON.stringify(found.conversionActions ?? []) !== JSON.stringify([action])) {
      update.conversionActions = [action];
      mask.push('conversionActions');
    }
    if (mask.length > 0) {
      await this.mutate(account, [{ customConversionGoalOperation: { update, updateMask: mask.join(',') } }]);
    }
    return found.resourceName as string;
  }

  /**
   * Send changes to the account.
   *
   * @param account - The account
   * @param operations - The changes
   * @returns The resource name of what each changed, in order
   */
  private async mutate(account: AccountContext, operations: GoogleMutateOperation[]): Promise<string[]> {
    return this.client.mutate(account.adAccountId, account.externalId, operations);
  }
}
