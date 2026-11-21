import {
  actionTag,
  CONVERSION_GAQL,
  conversionActionChanges,
  conversionActionFields,
  customGoalTag,
  GOOGLE_CONVERSION_CATEGORIES,
  GoogleConversions,
  sendToOf,
  valueSettingsOf,
} from '@src/platforms/google/google-conversions';
import { GoogleAdsRow, GoogleConversionAction } from '@src/platforms/google/google.types';
import { AccountContext, GoalSpec, TrackingSetup } from '@src/platforms/platform-adapter';
import { conversionCategorySchema } from '@src/types';

/** The client account. */
const CID = '5550001111';

/** The account as the adapter hands it. */
const ACCOUNT: AccountContext = {
  platform: 'google_ads',
  adAccountId: 'acc-1',
  externalId: CID,
  scope: {},
  credentials: null,
};

/** A goal as the tracking service hands it. */
const GOAL: GoalSpec = {
  id: 'f0000000-0000-4000-8000-000000000001',
  key: 'achat',
  name: 'Herbéa — Achat',
  category: 'purchase',
  valueMode: 'dynamic',
  defaultValueMicros: 89_000_000,
  currency: 'EUR',
  counting: 'every',
  status: 'active',
};

/** Resource names at Google. */
const ACTION = `customers/${CID}/conversionActions/111`;
const CUSTOM_GOAL = `customers/${CID}/customConversionGoals/222`;
const CAMPAIGN = `customers/${CID}/campaigns/333`;

/** The event snippet Google writes for a web page action. */
const SNIPPET = "gtag('event', 'conversion', {\n  'send_to': 'AW-987/AbC-d_1',\n  'transaction_id': ''\n});";

/**
 * The action of {@link GOAL} as Google reads it back.
 *
 * @param overrides - What differs
 * @returns The action
 */
function actionAt(overrides: GoogleConversionAction = {}): GoogleConversionAction {
  return {
    resourceName: ACTION,
    ...conversionActionFields(GOAL),
    tagSnippets: [
      { type: 'WEBPAGE_ONCLICK', eventSnippet: "gtag('event', 'conversion', {'send_to': 'AW-987/onclick'})" },
      { type: 'WEBPAGE', pageFormat: 'HTML', eventSnippet: SNIPPET },
    ],
    ...overrides,
  };
}

describe('Unit::Platforms::Google::Conversions', () => {
  let search: jest.Mock;
  let mutate: jest.Mock;
  let conversions: GoogleConversions;

  /**
   * Answer the searches by what they read.
   *
   * @param answers - Rows by a part of the query
   * @returns Nothing
   */
  function answer(answers: Record<string, GoogleAdsRow[]>): void {
    search.mockImplementation(async (_account: string, _customer: string, query: string): Promise<GoogleAdsRow[]> => {
      const match: string | undefined = Object.keys(answers).find((part: string): boolean => query.includes(part));
      return match === undefined ? [] : answers[match];
    });
  }

  beforeEach((): void => {
    search = jest.fn().mockResolvedValue([]);
    mutate = jest.fn().mockResolvedValue([]);
    conversions = new GoogleConversions({ search, mutate } as never);
  });

  describe('the mapping', () => {
    it('should map every category', (): void => {
      expect(Object.keys(GOOGLE_CONVERSION_CATEGORIES).sort()).toEqual([...conversionCategorySchema.options].sort());
    });

    it('should value a goal: none, fixed, or sent with a fallback', (): void => {
      expect(valueSettingsOf({ valueMode: 'none', defaultValueMicros: 10, currency: 'EUR' })).toEqual({
        defaultValue: 0,
        alwaysUseDefaultValue: true,
      });
      expect(valueSettingsOf({ valueMode: 'fixed', defaultValueMicros: 120_000_000, currency: 'USD' })).toEqual({
        defaultValue: 120,
        defaultCurrencyCode: 'USD',
        alwaysUseDefaultValue: true,
      });
      expect(valueSettingsOf({ valueMode: 'dynamic', defaultValueMicros: null, currency: null })).toEqual({
        defaultValue: 0,
        alwaysUseDefaultValue: false,
      });
    });

    it('should make a secondary web page action, counted 30 days after a click, its name tagged', (): void => {
      expect(conversionActionFields({ ...GOAL, counting: 'one' })).toEqual({
        name: `Herbéa — Achat ${actionTag(GOAL.id)}`,
        type: 'WEBPAGE',
        category: 'PURCHASE',
        status: 'ENABLED',
        countingType: 'ONE_PER_CLICK',
        valueSettings: { defaultValue: 89, defaultCurrencyCode: 'EUR', alwaysUseDefaultValue: false },
        clickThroughLookbackWindowDays: '30',
        primaryForGoal: false,
      });
      expect(conversionActionFields(GOAL).countingType).toBe('MANY_PER_CLICK');
      expect(actionTag(GOAL.id)).toMatch(/^\[op:[0-9a-f]{12}\]$/);
      expect(customGoalTag(GOAL.id)).not.toBe(actionTag(GOAL.id));
    });

    it('should keep the tag of a long name whole, within 100 characters', (): void => {
      const name: string = conversionActionFields({ ...GOAL, name: 'x'.repeat(200) }).name as string;

      expect(name).toHaveLength(100);
      expect(name.endsWith(` ${actionTag(GOAL.id)}`)).toBe(true);
    });

    it('should change nothing on an action that matches, Google leaving the defaults out', (): void => {
      const withoutDefault: GoogleConversionAction = actionAt();
      Reflect.deleteProperty(withoutDefault, 'primaryForGoal');

      expect(conversionActionChanges(withoutDefault, GOAL)).toEqual({ update: { resourceName: ACTION }, mask: [] });
    });

    it('should restore what was changed outside, and only that', (): void => {
      const changes = conversionActionChanges(
        actionAt({
          name: 'Renamed',
          primaryForGoal: true,
          valueSettings: { defaultValue: 10, defaultCurrencyCode: 'EUR' },
        }),
        GOAL
      );

      expect(changes).toEqual({
        update: {
          resourceName: ACTION,
          name: `Herbéa — Achat ${actionTag(GOAL.id)}`,
          primaryForGoal: false,
          valueSettings: { defaultValue: 89, defaultCurrencyCode: 'EUR', alwaysUseDefaultValue: false },
        },
        mask: ['name', 'primaryForGoal', 'valueSettings.defaultValue'],
      });
    });

    it('should read the send_to of the web page snippet only', (): void => {
      expect(sendToOf(actionAt())).toBe('AW-987/AbC-d_1');
      expect(sendToOf(actionAt({ tagSnippets: [{ type: 'WEBPAGE' }] }))).toBeNull();
      expect(sendToOf({ resourceName: ACTION })).toBeNull();
      expect(sendToOf(null)).toBeNull();
    });
  });

  describe('setupTracking', () => {
    it("should be ready with the account's Google tag", async (): Promise<void> => {
      answer({
        'FROM customer': [
          {
            customer: {
              conversionTrackingSetting: {
                conversionTrackingId: '987',
                conversionTrackingStatus: 'CONVERSION_TRACKING_MANAGED_BY_SELF',
                googleAdsConversionCustomer: `customers/${CID}`,
              },
            },
          },
        ],
      });

      await expect(conversions.setupTracking(ACCOUNT, '555-000-1111')).resolves.toEqual({
        status: 'ready',
        refs: { tagId: 'AW-987' },
        message: null,
        biddable: false,
      });
      expect(search).toHaveBeenCalledWith('acc-1', CID, CONVERSION_GAQL.tracking());
    });

    it('should be ready without a tag on an account never tracked: its first action turns it on', async (): Promise<void> => {
      answer({
        'FROM customer': [
          { customer: { conversionTrackingSetting: { conversionTrackingStatus: 'NOT_CONVERSION_TRACKED' } } },
        ],
      });

      await expect(conversions.setupTracking(ACCOUNT, '555-000-1111')).resolves.toEqual({
        status: 'ready',
        refs: { tagId: null },
        message: null,
        biddable: false,
      });
    });

    it('should be ready without a tag when Google answers no setting at all', async (): Promise<void> => {
      await expect(conversions.setupTracking(ACCOUNT, '555-000-1111')).resolves.toMatchObject({
        status: 'ready',
        refs: { tagId: null },
      });
    });

    it.each([
      [
        'our manager account',
        { conversionTrackingStatus: 'CONVERSION_TRACKING_MANAGED_BY_THIS_MANAGER' },
        'google_conversion_tracking_by_our_manager',
      ],
      [
        'another manager account',
        { conversionTrackingStatus: 'CONVERSION_TRACKING_MANAGED_BY_ANOTHER_MANAGER' },
        'google_conversion_tracking_by_other_manager',
      ],
      [
        'another account, by its setting',
        { conversionTrackingId: '987', googleAdsConversionCustomer: 'customers/9990001111' },
        'google_conversion_tracking_by_other_manager',
      ],
    ])(
      'should wait for someone when %s tracks the conversions',
      async (_label: string, setting: object, code: string): Promise<void> => {
        answer({ 'FROM customer': [{ customer: { conversionTrackingSetting: setting } }] });

        await expect(conversions.setupTracking(ACCOUNT, '555-000-1111')).resolves.toEqual({
          status: 'manual_required',
          refs: { tagId: null },
          message: expect.stringContaining('555-000-1111'),
          messageCode: code,
          messageParams: { account: '555-000-1111' },
          biddable: false,
        });
      }
    );
  });

  describe('setupGoal', () => {
    it('should create the action, read its label, and create its custom goal', async (): Promise<void> => {
      mutate.mockResolvedValueOnce([ACTION]).mockResolvedValueOnce([CUSTOM_GOAL]);
      search
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ conversionAction: actionAt() }])
        .mockResolvedValueOnce([]);

      await expect(conversions.setupGoal(ACCOUNT, GOAL, null)).resolves.toEqual<TrackingSetup>({
        status: 'ready',
        refs: { conversionAction: ACTION, sendTo: 'AW-987/AbC-d_1', customGoal: CUSTOM_GOAL },
        message: null,
        biddable: true,
      });
      expect(search.mock.calls.map((call: unknown[]): unknown => call[2])).toEqual([
        CONVERSION_GAQL.actionByTag(actionTag(GOAL.id)),
        CONVERSION_GAQL.actionByName(ACTION),
        CONVERSION_GAQL.customGoalByTag(customGoalTag(GOAL.id)),
      ]);
      expect(mutate.mock.calls).toEqual([
        ['acc-1', CID, [{ conversionActionOperation: { create: conversionActionFields(GOAL) } }]],
        [
          'acc-1',
          CID,
          [
            {
              customConversionGoalOperation: {
                create: {
                  name: `Herbéa — Achat ${customGoalTag(GOAL.id)}`,
                  conversionActions: [ACTION],
                  status: 'ENABLED',
                },
              },
            },
          ],
        ],
      ]);
      expect(CONVERSION_GAQL.actionByTag(actionTag(GOAL.id))).toContain(
        `conversion_action.name LIKE '%${actionTag(GOAL.id).slice(1, -1)}%'`
      );
    });

    it('should find what an interrupted setup created, by the names recorded, and change nothing that matches', async (): Promise<void> => {
      answer({
        'FROM conversion_action': [{ conversionAction: actionAt() }],
        'FROM custom_conversion_goal': [
          {
            customConversionGoal: {
              resourceName: CUSTOM_GOAL,
              name: `Herbéa — Achat ${customGoalTag(GOAL.id)}`,
              conversionActions: [ACTION],
            },
          },
        ],
      });

      await expect(
        conversions.setupGoal(ACCOUNT, GOAL, { conversionAction: ACTION, sendTo: null, customGoal: CUSTOM_GOAL })
      ).resolves.toMatchObject({ status: 'ready', refs: { customGoal: CUSTOM_GOAL } });
      expect(search.mock.calls.map((call: unknown[]): unknown => call[2])).toEqual([
        CONVERSION_GAQL.actionByName(ACTION),
        CONVERSION_GAQL.customGoalByName(CUSTOM_GOAL),
      ]);
      expect(mutate).not.toHaveBeenCalled();
    });

    it('should look the action up by its tag when the recorded one is gone, and update what differs', async (): Promise<void> => {
      search
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ conversionAction: actionAt({ countingType: 'ONE_PER_CLICK' }) }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { customConversionGoal: { resourceName: CUSTOM_GOAL, name: 'Old name', conversionActions: ['other'] } },
        ]);

      await expect(
        conversions.setupGoal(ACCOUNT, GOAL, {
          conversionAction: 'customers/x/conversionActions/gone',
          customGoal: CUSTOM_GOAL,
        })
      ).resolves.toMatchObject({ status: 'ready', refs: { conversionAction: ACTION, customGoal: CUSTOM_GOAL } });
      expect(mutate.mock.calls).toEqual([
        [
          'acc-1',
          CID,
          [
            {
              conversionActionOperation: {
                update: { resourceName: ACTION, countingType: 'MANY_PER_CLICK' },
                updateMask: 'countingType',
              },
            },
          ],
        ],
        [
          'acc-1',
          CID,
          [
            {
              customConversionGoalOperation: {
                update: {
                  resourceName: CUSTOM_GOAL,
                  name: `Herbéa — Achat ${customGoalTag(GOAL.id)}`,
                  conversionActions: [ACTION],
                },
                updateMask: 'name,conversionActions',
              },
            },
          ],
        ],
      ]);
    });

    it('should only rename a custom goal whose actions are right, and read one Google answers without them', async (): Promise<void> => {
      answer({
        'FROM conversion_action': [{ conversionAction: actionAt() }],
        'FROM custom_conversion_goal': [{ customConversionGoal: { resourceName: CUSTOM_GOAL, name: 'Old name' } }],
      });

      await conversions.setupGoal(ACCOUNT, GOAL, null);

      expect(mutate.mock.calls[0][2]).toEqual([
        {
          customConversionGoalOperation: {
            update: {
              resourceName: CUSTOM_GOAL,
              name: `Herbéa — Achat ${customGoalTag(GOAL.id)}`,
              conversionActions: [ACTION],
            },
            updateMask: 'name,conversionActions',
          },
        },
      ]);

      mutate.mockClear();
      answer({
        'FROM conversion_action': [{ conversionAction: actionAt() }],
        'FROM custom_conversion_goal': [
          { customConversionGoal: { resourceName: CUSTOM_GOAL, name: 'Old name', conversionActions: [ACTION] } },
        ],
      });

      await conversions.setupGoal(ACCOUNT, GOAL, null);

      expect(mutate.mock.calls[0][2]).toEqual([
        {
          customConversionGoalOperation: {
            update: { resourceName: CUSTOM_GOAL, name: `Herbéa — Achat ${customGoalTag(GOAL.id)}` },
            updateMask: 'name',
          },
        },
      ]);
    });

    it('should fall back on the tag when a recorded custom goal is gone', async (): Promise<void> => {
      search
        .mockResolvedValueOnce([{ conversionAction: actionAt() }])
        .mockResolvedValueOnce([{}])
        .mockResolvedValueOnce([]);
      mutate.mockResolvedValueOnce([CUSTOM_GOAL]);

      await conversions.setupGoal(ACCOUNT, GOAL, {
        conversionAction: ACTION,
        customGoal: 'customers/x/customConversionGoals/gone',
      });

      expect(search.mock.calls[2][2]).toBe(CONVERSION_GAQL.customGoalByTag(customGoalTag(GOAL.id)));
      expect(mutate).toHaveBeenCalledTimes(1);
    });

    it('should fail when Google gives no web page snippet, keeping what it created', async (): Promise<void> => {
      mutate.mockResolvedValueOnce([ACTION]);

      await expect(conversions.setupGoal(ACCOUNT, GOAL, { customGoal: CUSTOM_GOAL })).resolves.toEqual({
        status: 'failed',
        refs: { conversionAction: ACTION, sendTo: null, customGoal: CUSTOM_GOAL },
        message: `Google Ads gave no web page event snippet for the conversion action ${ACTION}`,
        messageCode: 'google_conversion_snippet_missing',
        messageParams: { conversionAction: ACTION },
        biddable: false,
      });
    });

    it('should fail without a custom goal to keep when none was recorded', async (): Promise<void> => {
      mutate.mockResolvedValueOnce([ACTION]);

      await expect(conversions.setupGoal(ACCOUNT, GOAL, null)).resolves.toMatchObject({
        status: 'failed',
        refs: { conversionAction: ACTION, sendTo: null, customGoal: null },
      });
    });

    it('should leave an archived goal where it is, and remove nothing (R5)', async (): Promise<void> => {
      answer({ 'FROM conversion_action': [{ conversionAction: actionAt() }] });

      await expect(
        conversions.setupGoal(
          ACCOUNT,
          { ...GOAL, status: 'archived' },
          { conversionAction: ACTION, customGoal: CUSTOM_GOAL }
        )
      ).resolves.toEqual({
        status: 'paused',
        refs: { conversionAction: ACTION, sendTo: 'AW-987/AbC-d_1', customGoal: CUSTOM_GOAL },
        message: null,
        biddable: false,
      });
      expect(mutate).not.toHaveBeenCalled();
    });

    it('should pause an archived goal that has nothing at Google', async (): Promise<void> => {
      await expect(conversions.setupGoal(ACCOUNT, { ...GOAL, status: 'archived' }, null)).resolves.toEqual({
        status: 'paused',
        refs: { conversionAction: null, sendTo: null, customGoal: null },
        message: null,
        biddable: false,
      });
    });
  });

  describe('goalOperations', () => {
    it('should point the campaign at the custom goal, and take every other goal out of its bidding', async (): Promise<void> => {
      answer({
        'FROM conversion_goal_campaign_config': [{ conversionGoalCampaignConfig: { goalConfigLevel: 'CUSTOMER' } }],
        'FROM campaign_conversion_goal': [
          {
            campaignConversionGoal: {
              resourceName: `customers/${CID}/campaignConversionGoals/333~PURCHASE~WEBSITE`,
              biddable: true,
            },
          },
          {
            campaignConversionGoal: {
              resourceName: `customers/${CID}/campaignConversionGoals/333~LEAD~WEBSITE`,
              biddable: false,
            },
          },
          {},
        ],
      });

      await expect(conversions.goalOperations(ACCOUNT, CAMPAIGN, CUSTOM_GOAL)).resolves.toEqual([
        {
          conversionGoalCampaignConfigOperation: {
            update: {
              resourceName: `customers/${CID}/conversionGoalCampaignConfigs/333`,
              customConversionGoal: CUSTOM_GOAL,
            },
            updateMask: 'customConversionGoal',
          },
        },
        {
          campaignConversionGoalOperation: {
            update: { resourceName: `customers/${CID}/campaignConversionGoals/333~PURCHASE~WEBSITE`, biddable: false },
            updateMask: 'biddable',
          },
        },
      ]);
      expect(search.mock.calls.map((call: unknown[]): unknown => call[2])).toEqual([
        CONVERSION_GAQL.goalConfig('333'),
        CONVERSION_GAQL.campaignGoals('333'),
      ]);
    });

    it('should send nothing for a campaign that already bids on its goal alone', async (): Promise<void> => {
      answer({
        'FROM conversion_goal_campaign_config': [
          { conversionGoalCampaignConfig: { customConversionGoal: CUSTOM_GOAL } },
        ],
      });

      await expect(conversions.goalOperations(ACCOUNT, CAMPAIGN, CUSTOM_GOAL)).resolves.toEqual([]);
    });

    it('should refuse a goal without custom goal on the account', async (): Promise<void> => {
      await expect(conversions.goalOperations(ACCOUNT, CAMPAIGN, null)).rejects.toMatchObject({
        options: { messageCode: 'google_conversion_goal_unavailable' },
      });
      expect(search).not.toHaveBeenCalled();
    });
  });
});
