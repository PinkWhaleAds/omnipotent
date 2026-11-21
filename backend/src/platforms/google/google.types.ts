/**
 * @module platforms/google/google.types
 *
 * What Omnipotent reads and sends of the Google Ads API, transcribed from multi-search
 * (`~/OmniAd/multi-search/backend/src/platforms/google/google.types.ts`), which runs it against the
 * real API. Only what the connection of an account needs lives here so far (`docs/phase-10.md` § 5);
 * the campaigns add their own shapes in lot 3.
 */

/**
 * The fixed facts of the API.
 *
 * - **No developer token** since 2026-09-09: the header is "optional and ignored", and the access
 *   level belongs to the Google Cloud project of the service account (`docs/plateformes/google-ads.md`
 *   § 4). The only headers are the bearer token and `login-customer-id`, our manager account.
 * - **`v25`**, whose end is announced for August 2027 (multi-search's study, read on Google's
 *   documentation on 2026-10-07). Moving up is this line and a reading of the release notes.
 */
export const GOOGLE_ADS_API = {
  /** Base URL of the REST API, version included. */
  baseUrl: 'https://googleads.googleapis.com/v25',
  /** The OAuth 2.0 token endpoint, for the service account and the inviter alike. */
  tokenUrl: 'https://oauth2.googleapis.com/token',
  /** The consent page a person signs in on, for the inviter. */
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  /** The one scope of the Google Ads API. */
  scope: 'https://www.googleapis.com/auth/adwords',
  /** The grant of a service account: a signed JWT exchanged for a token (RFC 7523). */
  grantType: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
  /** The header naming the manager account we act through. */
  loginCustomerHeader: 'login-customer-id',
  /** The response header carrying Google's id of a request. */
  requestIdHeader: 'request-id',
  /** Longest wait for an answer of the API. */
  timeoutMs: 30_000,
  /** Longest wait for an answer of the token endpoint. */
  tokenTimeoutMs: 10_000,
  /** How long a signed assertion is valid; Google allows an hour at most. */
  assertionLifetimeSeconds: 3_600,
  /** How long a person's access token lives, when Google does not say. */
  userTokenLifetimeSeconds: 3_600,
  /** How long before its expiry a token is renewed, so that none expires in flight. */
  tokenExpirySkewSeconds: 60,
} as const;

/**
 * A service account key, as Google Cloud downloads it.
 *
 * @property client_email - The service account, which signs as itself
 * @property private_key - The PEM private key
 * @property private_key_id - Its id, sent as the `kid` of the assertion
 * @property token_uri - Where its tokens are asked, when the key names one
 */
export type GoogleServiceAccountKey = {
  type?: string;
  client_email: string;
  private_key: string;
  private_key_id?: string;
  token_uri?: string;
};

/**
 * The OAuth credentials of our **inviter**: a human admin of our MCC, the only kind of user Google lets
 * send and withdraw a manager link invitation (`docs/phase-10.md` § 3). `pnpm google:connect` writes
 * them.
 *
 * @property clientId - Our « Desktop app » OAuth client
 * @property clientSecret - Its secret
 * @property refreshToken - What the admin's consent gave, exchanged for an access token when needed
 */
export type GoogleInviterSecret = { clientId: string; clientSecret: string; refreshToken: string };

/**
 * A successful answer of the token endpoint.
 *
 * @property access_token - The token
 * @property expires_in - Its lifetime, in seconds
 * @property refresh_token - What a consent gives, once, for an offline access
 * @property scope - The scopes granted, separated by spaces
 */
export type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
};

/**
 * A refusal of the token endpoint.
 *
 * @property error - The OAuth error (`invalid_grant`…)
 * @property error_description - What it says of it
 */
export type GoogleTokenErrorBody = { error?: string; error_description?: string };

/**
 * One error of a `GoogleAdsFailure`.
 *
 * @property errorCode - Its family and code, as `{ authorizationError: 'USER_PERMISSION_DENIED' }`
 * @property message - What it says
 * @property trigger - The faulty value, when there is one
 */
export type GoogleAdsErrorEntry = {
  errorCode?: Record<string, string>;
  message?: string;
  trigger?: { stringValue?: string };
};

/**
 * The detail of a failed call that lists the Google Ads errors.
 *
 * @property errors - The errors, in order
 * @property requestId - Google's id of the request
 */
export type GoogleAdsFailure = { '@type': string; errors?: GoogleAdsErrorEntry[]; requestId?: string };

/**
 * The envelope of a failed call.
 *
 * @property error.code - HTTP status, again
 * @property error.message - What it says
 * @property error.status - Its gRPC status (`PERMISSION_DENIED`…)
 * @property error.details - Its details, among which the `GoogleAdsFailure`
 */
export type GoogleAdsErrorBody = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: ({ '@type'?: string } & Record<string, unknown>)[];
  };
};

/** The status of a link of our manager account, as Google writes it. */
export type GoogleClientLinkStatus = 'ACTIVE' | 'PENDING' | 'REFUSED' | 'CANCELED' | 'INACTIVE' | string;

/**
 * One row of a GAQL search: the resources it selected, by name.
 *
 * @property campaign - A campaign
 * @property campaignBudget - Its budget
 * @property campaignCriterion - A place or a circle it targets
 * @property adGroup - An ad group
 * @property adGroupCriterion - A keyword of an ad group
 * @property adGroupBidModifier - A device an ad group adjusts its bids on
 * @property adGroupAd - An ad
 * @property campaignAsset - An asset linked to a campaign
 * @property asset - An asset of the account
 * @property customerClientLink - A link of our manager account to a client account
 * @property customer - The account queried
 * @property conversionAction - A conversion action of the account
 * @property customConversionGoal - A custom conversion goal of the account
 * @property conversionGoalCampaignConfig - The goals a campaign bids on
 * @property campaignConversionGoal - A category × origin goal of a campaign
 */
export type GoogleAdsRow = {
  campaign?: GoogleCampaign;
  campaignBudget?: GoogleCampaignBudget;
  campaignCriterion?: GoogleCampaignCriterion;
  adGroup?: GoogleAdGroup;
  adGroupCriterion?: GoogleAdGroupCriterion;
  adGroupBidModifier?: GoogleAdGroupBidModifier;
  adGroupAd?: GoogleAdGroupAd;
  campaignAsset?: GoogleCampaignAsset;
  asset?: GoogleAsset;
  customerClientLink?: {
    resourceName?: string;
    clientCustomer?: string;
    managerLinkId?: string;
    status?: GoogleClientLinkStatus;
  };
  customer?: {
    id?: string;
    descriptiveName?: string;
    currencyCode?: string;
    timeZone?: string;
    manager?: boolean;
    conversionTrackingSetting?: GoogleConversionTrackingSetting;
  };
  conversionAction?: GoogleConversionAction;
  customConversionGoal?: GoogleCustomConversionGoal;
  conversionGoalCampaignConfig?: GoogleConversionGoalCampaignConfig;
  campaignConversionGoal?: GoogleCampaignConversionGoal;
};

/**
 * Where the conversions of an account are tracked (`docs/phase-10.md` § 8.10).
 *
 * @property conversionTrackingId - The number of the account's Google tag (`AW-<number>`), absent until
 *   the account tracks conversions
 * @property conversionTrackingStatus - `NOT_CONVERSION_TRACKED`, `CONVERSION_TRACKING_MANAGED_BY_SELF`,
 *   `…_BY_THIS_MANAGER` or `…_BY_ANOTHER_MANAGER`
 * @property googleAdsConversionCustomer - The account that creates and manages the conversions
 */
export type GoogleConversionTrackingSetting = {
  conversionTrackingId?: string;
  conversionTrackingStatus?: string;
  googleAdsConversionCustomer?: string;
};

/**
 * The value of the conversions of an action.
 *
 * @property defaultValue - In units of the currency
 * @property defaultCurrencyCode - ISO 4217
 * @property alwaysUseDefaultValue - Whether the value the site sends is ignored
 */
export type GoogleValueSettings = {
  defaultValue?: number;
  defaultCurrencyCode?: string;
  alwaysUseDefaultValue?: boolean;
};

/**
 * One of the snippets Google gives a conversion action.
 *
 * @property type - `WEBPAGE`, `WEBPAGE_ONCLICK`…
 * @property eventSnippet - The `gtag('event', 'conversion', { send_to: 'AW-…/label' })` call
 */
export type GoogleTagSnippet = { type?: string; pageFormat?: string; globalSiteTag?: string; eventSnippet?: string };

/** A conversion action, as created and read. */
export type GoogleConversionAction = {
  resourceName?: string;
  id?: string;
  name?: string;
  type?: string;
  category?: string;
  status?: string;
  countingType?: string;
  valueSettings?: GoogleValueSettings;
  clickThroughLookbackWindowDays?: string;
  primaryForGoal?: boolean;
  tagSnippets?: GoogleTagSnippet[];
};

/** A custom conversion goal: a list of conversion actions a campaign bids on, secondary ones included. */
export type GoogleCustomConversionGoal = {
  resourceName?: string;
  name?: string;
  conversionActions?: string[];
  status?: string;
};

/** The goals a campaign bids on: the account's, or a custom goal of its own (`CAMPAIGN`). */
export type GoogleConversionGoalCampaignConfig = {
  resourceName?: string;
  customConversionGoal?: string;
  goalConfigLevel?: string;
};

/** A category × origin goal of a campaign, and whether the campaign bids on it. */
export type GoogleCampaignConversionGoal = {
  resourceName?: string;
  category?: string;
  origin?: string;
  biddable?: boolean;
};

/**
 * A change of a link of our MCC, sent as our inviter.
 *
 * @property operation.create - An invitation to a client account
 * @property operation.update - A new status of an existing link (`CANCELED` withdraws an invitation)
 * @property operation.updateMask - The fields an update changes
 */
export type GoogleClientLinkRequest = {
  operation:
    | { create: { clientCustomer: string; status: 'PENDING' } }
    | { update: { resourceName: string; status: 'CANCELED' }; updateMask: 'status' };
};

/**
 * A page of a GAQL search.
 *
 * @property results - Its rows
 * @property nextPageToken - Where the next page starts, absent on the last
 */
export type GoogleAdsSearchResponse = { results?: GoogleAdsRow[]; nextPageToken?: string };

/** A status Google gives an object it serves; `REMOVED` is never sent by us (R5). */
export type GoogleStatus = 'ENABLED' | 'PAUSED' | 'REMOVED';

/**
 * A campaign budget, its own and never shared (`plateformes/google-ads.md` § 1).
 *
 * @property amountMicros - What it may spend a day, in micros of the account currency, as a string
 */
export type GoogleCampaignBudget = {
  resourceName?: string;
  name?: string;
  amountMicros?: string;
  deliveryMethod?: 'STANDARD';
  explicitlyShared?: boolean;
};

/** Where a Search campaign shows. */
export type GoogleNetworkSettings = {
  targetGoogleSearch?: boolean;
  targetSearchNetwork?: boolean;
  targetContentNetwork?: boolean;
  targetPartnerSearchNetwork?: boolean;
};

/** Who a targeted place reaches. */
export type GoogleGeoTargetTypeSetting = { positiveGeoTargetType?: string; negativeGeoTargetType?: string };

/** A campaign, as we write and read it. */
export type GoogleCampaign = {
  resourceName?: string;
  id?: string;
  name?: string;
  status?: GoogleStatus;
  advertisingChannelType?: 'SEARCH';
  campaignBudget?: string;
  networkSettings?: GoogleNetworkSettings;
  geoTargetTypeSetting?: GoogleGeoTargetTypeSetting;
  aiMaxSetting?: { enableAiMax?: boolean };
  containsEuPoliticalAdvertising?: string;
  startDateTime?: string;
  endDateTime?: string;
  biddingStrategyType?: string;
  manualCpc?: { enhancedCpcEnabled?: boolean };
  targetSpend?: { cpcBidCeilingMicros?: string };
  maximizeConversions?: { targetCpaMicros?: string };
};

/** A circle around a point. */
export type GoogleProximity = {
  geoPoint?: { latitudeInMicroDegrees?: number; longitudeInMicroDegrees?: number };
  radius?: number;
  radiusUnits?: 'KILOMETERS';
};

/** A place or a circle a campaign targets, or excludes. */
export type GoogleCampaignCriterion = {
  resourceName?: string;
  campaign?: string;
  negative?: boolean;
  location?: { geoTargetConstant?: string };
  proximity?: GoogleProximity;
};

/** An ad group. */
export type GoogleAdGroup = {
  resourceName?: string;
  id?: string;
  campaign?: string;
  name?: string;
  status?: GoogleStatus;
  type?: 'SEARCH_STANDARD';
  cpcBidMicros?: string;
};

/** A keyword of an ad group: a negative one has no status. */
export type GoogleAdGroupCriterion = {
  resourceName?: string;
  adGroup?: string;
  status?: GoogleStatus;
  negative?: boolean;
  keyword?: { text?: string; matchType?: string };
};

/** A device an ad group adjusts its bids on: `0` excludes it. */
export type GoogleAdGroupBidModifier = {
  resourceName?: string;
  adGroup?: string;
  device?: { type?: string };
  bidModifier?: number;
};

/** A responsive search ad. */
export type GoogleAd = {
  resourceName?: string;
  id?: string;
  finalUrls?: string[];
  urlCustomParameters?: { key: string; value: string }[];
  responsiveSearchAd?: {
    headlines?: { text: string }[];
    descriptions?: { text: string }[];
    path1?: string;
    path2?: string;
  };
};

/**
 * What Google made of an ad: where its review stands, its verdict, and the policy topics behind a
 * verdict that limits or forbids it.
 */
export type GooglePolicySummary = {
  reviewStatus?: string;
  approvalStatus?: string;
  policyTopicEntries?: { topic?: string; type?: string }[];
};

/** An ad in its ad group. */
export type GoogleAdGroupAd = {
  resourceName?: string;
  adGroup?: string;
  status?: GoogleStatus;
  ad?: GoogleAd;
  policySummary?: GooglePolicySummary;
};

/** What an asset of the account holds: one of these. */
export type GoogleAsset = {
  resourceName?: string;
  name?: string;
  type?: string;
  finalUrls?: string[];
  sitelinkAsset?: { linkText?: string; description1?: string; description2?: string };
  calloutAsset?: { calloutText?: string };
  structuredSnippetAsset?: { header?: string; values?: string[] };
  textAsset?: { text?: string };
  imageAsset?: { data?: string };
};

/** An asset shown by a campaign, in one role. */
export type GoogleCampaignAsset = {
  resourceName?: string;
  campaign?: string;
  asset?: string;
  fieldType?: string;
  status?: GoogleStatus;
};

/** One operation of a `googleAds:mutate`: create, update with its mask, or remove. */
export type GoogleOperation<T> = { create: T } | { update: T; updateMask: string } | { remove: string };

/** One operation of a `googleAds:mutate`, by the resource it changes. */
export type GoogleMutateOperation =
  | { campaignBudgetOperation: GoogleOperation<GoogleCampaignBudget> }
  | { campaignOperation: GoogleOperation<GoogleCampaign> }
  | { campaignCriterionOperation: GoogleOperation<GoogleCampaignCriterion> }
  | { adGroupOperation: GoogleOperation<GoogleAdGroup> }
  | { adGroupCriterionOperation: GoogleOperation<GoogleAdGroupCriterion> }
  | { adGroupBidModifierOperation: GoogleOperation<GoogleAdGroupBidModifier> }
  | { adGroupAdOperation: GoogleOperation<GoogleAdGroupAd> }
  | { adOperation: GoogleOperation<GoogleAd> }
  | { assetOperation: GoogleOperation<GoogleAsset> }
  | { campaignAssetOperation: GoogleOperation<GoogleCampaignAsset> }
  | { conversionActionOperation: GoogleOperation<GoogleConversionAction> }
  | { customConversionGoalOperation: GoogleOperation<GoogleCustomConversionGoal> }
  | { conversionGoalCampaignConfigOperation: GoogleOperation<GoogleConversionGoalCampaignConfig> }
  | { campaignConversionGoalOperation: GoogleOperation<GoogleCampaignConversionGoal> };

/**
 * The answer of a `googleAds:mutate`: one result per operation, in order, each naming what it
 * created or changed under its own key (`campaignResult`, `adGroupResult`…).
 */
export type GoogleMutateResponse = {
  mutateOperationResponses?: Record<string, { resourceName?: string } | undefined>[];
};
