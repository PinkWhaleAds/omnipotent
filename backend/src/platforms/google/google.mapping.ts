/**
 * @module platforms/google/google.mapping
 *
 * What our desired state becomes in Google Ads' own words — pure functions, transcribed from
 * multi-search (`src/platforms/google/google.mapping.ts`, our code) and adapted to a state made of
 * **projected objects** (`docs/phase-10.md` § 8.5): every object of the budget level is a Google
 * campaign, the ad groups hang from it, the ads and the keywords from them.
 *
 * Nothing here calls Google: the adapter reads, diffs and sends (`google.adapter.ts`).
 */
import { DesiredAsset, DesiredObject, DesiredUnit, fingerprint } from '@src/platforms/desired-state';
import { PlatformError } from '@src/platforms/platform-adapter';
import {
  AdReview,
  BidStrategy,
  Extensions,
  LocationIntent,
  MatchType,
  NodeStatus,
  ReviewStatus,
  SnippetHeader,
  Targeting,
} from '@src/types';
import { geoTargetConstant } from './google-geo';
import {
  GoogleAd,
  GoogleAsset,
  GoogleCampaign,
  GoogleCampaignCriterion,
  GoogleNetworkSettings,
  GooglePolicySummary,
  GoogleProximity,
  GoogleStatus,
} from './google.types';

/** Our verdict of an ad, from Google's approval status; any other status is still `pending`. */
const APPROVAL_STATUSES: ReadonlyMap<string, ReviewStatus> = new Map<string, ReviewStatus>([
  ['APPROVED', 'approved'],
  ['APPROVED_LIMITED', 'limited'],
  ['AREA_OF_INTEREST_ONLY', 'limited'],
  ['DISAPPROVED', 'rejected'],
]);

/** The kinds of policy topic that limit an ad, where `PROHIBITED` forbids it. */
const LIMITING_TOPIC_TYPES: ReadonlySet<string> = new Set(['LIMITED', 'FULLY_LIMITED', 'AREA_OF_INTEREST_ONLY']);

/** The custom URL parameter that names our Line on each ad: what the reports attach to (phase 15). */
export const MSKEY = 'mskey';

/** What every campaign declares about political advertising: the preview refuses the other case (D53). */
export const EU_POLITICAL_ADVERTISING = 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING';

/** How long a name may be at Google. */
const MAX_NAME_LENGTH = 255;

/** Google's match type of each of ours. */
const MATCH_TYPES: Readonly<Record<MatchType, string>> = { broad: 'BROAD', phrase: 'PHRASE', exact: 'EXACT' };

/** The devices a Search ad group adjusts its bids on, in Google's words. */
const DEVICES: Readonly<Record<string, string>> = { desktop: 'DESKTOP', mobile: 'MOBILE', tablet: 'TABLET' };

/** Who an included place reaches; an excluded one always excludes the people in it. */
const POSITIVE_GEO_TARGET_TYPES: Readonly<Record<LocationIntent, string>> = {
  presence: 'PRESENCE',
  presence_or_interest: 'PRESENCE_OR_INTEREST',
};

/** The header of a structured snippet, in Google's English words. */
export const SNIPPET_HEADERS: Readonly<Record<SnippetHeader, string>> = {
  amenities: 'Amenities',
  brands: 'Brands',
  courses: 'Courses',
  degree_programs: 'Degree programs',
  destinations: 'Destinations',
  featured_hotels: 'Featured hotels',
  insurance_coverage: 'Insurance coverage',
  models: 'Models',
  neighborhoods: 'Neighborhoods',
  service_catalog: 'Services',
  shows: 'Shows',
  styles: 'Styles',
  types: 'Types',
};

/** The roles of an asset we link to a campaign, and the only ones we ever unlink. */
export const MANAGED_FIELD_TYPES: readonly string[] = [
  'SITELINK',
  'CALLOUT',
  'STRUCTURED_SNIPPET',
  'BUSINESS_NAME',
  'BUSINESS_LOGO',
  'AD_IMAGE',
];

/**
 * Currencies whose minimum unit is a whole unit (1 000 000 micros), from Google's "Currency codes"
 * table; every other currency counts in hundredths (10 000 micros).
 */
const WHOLE_UNIT_CURRENCIES: ReadonlySet<string> = new Set([
  'CLP',
  'COP',
  'IDR',
  'JPY',
  'KRW',
  'PKR',
  'RSD',
  'TRL',
  'VND',
]);

/**
 * One Google campaign of the unit: an object of the budget level — the AdGroup, or a TargetingGroup
 * the split gave its own —, and its ad groups.
 *
 * @property key - The key of its object, which its id is kept under
 * @property campaign - That object
 * @property adGroups - The ad groups hanging from it
 */
export type CampaignSlot = { key: string; campaign: DesiredObject; adGroups: AdGroupSlot[] };

/**
 * One ad group: a TargetingGroup, with its ads and its keywords.
 *
 * @property key - The key of its object
 * @property adGroup - That object
 * @property ads - Its Lines
 * @property keywords - Its keywords, positive and negative
 */
export type AdGroupSlot = { key: string; adGroup: DesiredObject; ads: DesiredObject[]; keywords: DesiredObject[] };

/**
 * A refusal of ours, worded before Google is asked: never worth retrying.
 *
 * @param message - What is wrong
 * @param messageCode - Its stable code
 * @param messageParams - Its values
 * @returns The error
 */
export function refusal(
  message: string,
  messageCode: string,
  messageParams: Record<string, string | number> = {}
): PlatformError {
  return new PlatformError('google_ads', message, {
    statusCode: null,
    retryable: false,
    invalidCredentials: false,
    requestId: null,
    messageCode,
    messageParams,
  });
}

/**
 * The key `refs` keeps the implicit ad group of a campaign under: the campaign holds its own key.
 *
 * @param campaignKey - The key of the campaign
 * @returns The key of its ad group
 */
export function implicitAdGroupKey(campaignKey: string): string {
  return `${campaignKey}#ad_group`;
}

/**
 * The Google campaigns of a unit, with what hangs from each, parents first.
 *
 * A campaign whose ads and keywords hang from it directly — the TargetingGroup that is both (D55) —
 * holds one **implicit** ad group, the campaign's own node, kept in `refs` under its own key. A
 * projection that gives the ad groups a level of their own is read as it is.
 *
 * @param desired - The desired state
 * @returns One slot per object of the campaign kind
 */
export function campaignSlots(desired: DesiredUnit): CampaignSlot[] {
  const childrenOf = (key: string, object: string): DesiredObject[] =>
    desired.objects.filter(
      (candidate: DesiredObject): boolean => candidate.parentKey === key && candidate.object === object
    );
  const slotOf = (key: string, adGroup: DesiredObject, parentKey: string): AdGroupSlot => ({
    key,
    adGroup,
    ads: childrenOf(parentKey, 'ad'),
    keywords: childrenOf(parentKey, 'keyword'),
  });
  return desired.objects
    .filter((object: DesiredObject): boolean => object.object === 'campaign')
    .map((campaign: DesiredObject): CampaignSlot => {
      const own: AdGroupSlot = slotOf(implicitAdGroupKey(campaign.key), campaign, campaign.key);
      return {
        key: campaign.key,
        campaign,
        adGroups: [
          ...(own.ads.length + own.keywords.length > 0 ? [own] : []),
          ...childrenOf(campaign.key, 'ad_group').map((adGroup: DesiredObject): AdGroupSlot =>
            slotOf(adGroup.key, adGroup, adGroup.key)
          ),
        ],
      };
    });
}

/**
 * The tag a campaign or an ad group carries in its name: what finds it again when a synchronization
 * died between Google's answer and the writing of `refs` (`plateformes/google-ads.md` § 7).
 *
 * @param unitId - Our unit
 * @param key - The key of its object
 * @returns `[op:<12 hexadecimal characters>]`
 */
export function nameTag(unitId: string, key: string): string {
  return `[op:${fingerprint(`${unitId}:${key}`, 12)}]`;
}

/**
 * The name of an object at Google: ours, its tag kept whole however long the name is.
 *
 * @param name - Its name with us
 * @param tag - Its tag
 * @returns The name Google shows
 */
export function taggedName(name: string, tag: string): string {
  const room: number = MAX_NAME_LENGTH - tag.length - 1;
  return `${name.length > room ? name.slice(0, room) : name} ${tag}`;
}

/**
 * Round micros to the smallest unit of a currency, never under it.
 *
 * @param micros - The amount
 * @param currency - ISO 4217
 * @returns Micros Google accepts
 */
export function roundMicros(micros: number, currency: string): number {
  const unit: number = WHOLE_UNIT_CURRENCIES.has(currency.toUpperCase()) ? 1_000_000 : 10_000;
  return Math.max(unit, Math.round(micros / unit) * unit);
}

/**
 * The wall clock of an instant in a timezone, as Google writes a date and a time.
 *
 * @param instant - Epoch milliseconds
 * @param timezone - IANA timezone
 * @returns `YYYY-MM-DD HH:mm:ss`
 */
export function wallClock(instant: number, timezone: string): string {
  const parts: Record<string, string> = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(instant)
      .map((part: Intl.DateTimeFormatPart): [string, string] => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/**
 * The start of a campaign, sent only while it is to come in the account's timezone: Google refuses a
 * start in the past.
 *
 * @param startsOn - Its first day
 * @param timezone - The account's timezone
 * @param now - Now, epoch milliseconds
 * @returns `YYYY-MM-DD 00:00:00`, or `null` once that day has begun
 */
export function startDateTime(startsOn: string, timezone: string, now: number): string | null {
  const start = `${startsOn} 00:00:00`;
  return start > wallClock(now, timezone) ? start : null;
}

/**
 * The end of a campaign, sent only while it is to come: Google refuses an end in the past.
 *
 * @param endsOn - Its last day
 * @param timezone - The account's timezone
 * @param now - Now, epoch milliseconds
 * @returns `YYYY-MM-DD 23:59:59`, or `null` once it has passed
 */
export function endDateTime(endsOn: string, timezone: string, now: number): string | null {
  const end = `${endsOn} 23:59:59`;
  return end > wallClock(now, timezone) ? end : null;
}

/**
 * Google's status of an object.
 *
 * @param status - Ours
 * @returns `ENABLED` or `PAUSED`
 */
export function googleStatus(status: NodeStatus): GoogleStatus {
  return status === 'active' ? 'ENABLED' : 'PAUSED';
}

/**
 * How a campaign bids, in Google's words (`plateformes/google-ads.md` § 5).
 *
 * @param strategy - Ours, inherited from the AdGroup
 * @param bidMicros - Its amount: the ceiling of `maximize_clicks`
 * @param currency - The account's currency
 * @returns The bidding fields of the campaign
 * @throws PlatformError coded `google_bid_strategy_unsupported` for a strategy Google Search does
 *   not bid with here — which the preview refuses first
 */
export function campaignBidding(
  strategy: BidStrategy | null,
  bidMicros: number | null,
  currency: string
): Pick<GoogleCampaign, 'manualCpc' | 'targetSpend'> {
  if (strategy === 'max_cpc') return { manualCpc: { enhancedCpcEnabled: false } };
  if (strategy === 'maximize_clicks') {
    return {
      targetSpend: bidMicros === null ? {} : { cpcBidCeilingMicros: String(roundMicros(bidMicros, currency)) },
    };
  }
  throw refusal(`Google Search does not bid with ${String(strategy)} here`, 'google_bid_strategy_unsupported', {
    strategy: String(strategy),
  });
}

/**
 * The maximum bid of an ad group, under a manual CPC.
 *
 * @param strategy - The strategy of its campaign
 * @param bidMicros - Its own bid, else its campaign's
 * @param currency - The account's currency
 * @returns Micros as a string, `undefined` when the strategy sets bids itself
 * @throws PlatformError coded `google_bid_required` for a manual CPC with no amount
 */
export function adGroupCpcBid(
  strategy: BidStrategy | null,
  bidMicros: number | null,
  currency: string
): string | undefined {
  if (strategy !== 'max_cpc') return undefined;
  if (bidMicros === null) throw refusal('A manual CPC needs a maximum bid', 'google_bid_required');
  return String(roundMicros(bidMicros, currency));
}

/**
 * Where a Search campaign shows: Google Search always, its partners as the lever says, never the
 * Display network nor the content partners.
 *
 * @param settings - The settings of Google on the lever, defaults filled in
 * @returns The network settings
 */
export function networkSettings(settings: Readonly<Record<string, boolean>>): Required<GoogleNetworkSettings> {
  return {
    targetGoogleSearch: true,
    targetSearchNetwork: settings.searchPartners === true,
    targetContentNetwork: false,
    targetPartnerSearchNetwork: false,
  };
}

/**
 * Who the places of a campaign reach.
 *
 * @param intent - The AdGroup's
 * @returns The geo target type setting
 */
export function geoTargetTypeSetting(intent: LocationIntent): Required<GoogleCampaign>['geoTargetTypeSetting'] {
  return { positiveGeoTargetType: POSITIVE_GEO_TARGET_TYPES[intent], negativeGeoTargetType: 'PRESENCE' };
}

/**
 * The include/exclude lists of a dimension, empty when it is not asked for.
 *
 * @param targeting - A node's targeting
 * @param dimension - The dimension
 * @returns Its lists
 */
function includeExclude(
  targeting: Targeting | null,
  dimension: 'country' | 'device'
): { include: string[]; exclude: string[] } {
  const value = (targeting?.[dimension] ?? {}) as { include?: string[]; exclude?: string[] };
  return { include: value.include ?? [], exclude: value.exclude ?? [] };
}

/**
 * The places and circles a campaign targets, from the targeting its ad groups share
 * (`sharedTargeting`, which the preview makes equal).
 *
 * @param targeting - The targeting of its first ad group
 * @param campaign - The campaign's resource name
 * @returns Its criteria
 * @throws PlatformError coded `google_country_unsupported` for an included country Google does not
 *   target; an excluded one is simply left out
 */
export function campaignCriteria(targeting: Targeting | null, campaign: string): GoogleCampaignCriterion[] {
  const countries: { include: string[]; exclude: string[] } = includeExclude(targeting, 'country');
  const criteria: GoogleCampaignCriterion[] = countries.include.map((country: string): GoogleCampaignCriterion => {
    const constant: string | null = geoTargetConstant(country);
    if (constant === null) {
      throw refusal(`Google Ads cannot target the country ${country}`, 'google_country_unsupported', { country });
    }
    return { campaign, location: { geoTargetConstant: constant } };
  });
  for (const country of countries.exclude) {
    const constant: string | null = geoTargetConstant(country);
    if (constant !== null) criteria.push({ campaign, negative: true, location: { geoTargetConstant: constant } });
  }
  const points = (
    (targeting?.proximity ?? { points: [] }) as {
      points: { latitude: number; longitude: number; radiusKm: number }[];
    }
  ).points;
  for (const point of points) {
    criteria.push({
      campaign,
      proximity: {
        geoPoint: {
          latitudeInMicroDegrees: Math.round(point.latitude * 1_000_000),
          longitudeInMicroDegrees: Math.round(point.longitude * 1_000_000),
        },
        radius: point.radiusKm,
        radiusUnits: 'KILOMETERS',
      },
    });
  }
  return criteria;
}

/**
 * What tells two criteria of a campaign apart, whatever Google gave them as ids: a place or a circle
 * is immutable, so a changed one is removed and created again (`plateformes/google-ads.md` § 1).
 *
 * @param criterion - The criterion
 * @returns Its content key
 */
export function criterionKey(criterion: GoogleCampaignCriterion): string {
  if (criterion.location) {
    return JSON.stringify(['location', criterion.negative === true, criterion.location.geoTargetConstant]);
  }
  const proximity: GoogleProximity = criterion.proximity ?? {};
  return JSON.stringify([
    'proximity',
    Number(proximity.geoPoint?.latitudeInMicroDegrees),
    Number(proximity.geoPoint?.longitudeInMicroDegrees),
    Number(proximity.radius),
  ]);
}

/**
 * The devices an ad group leaves out: a bid modifier of `0` on each.
 *
 * @param targeting - Its targeting
 * @returns Google's device types, sorted
 */
export function excludedDevices(targeting: Targeting | null): string[] {
  const devices: { include: string[]; exclude: string[] } = includeExclude(targeting, 'device');
  return Object.keys(DEVICES)
    .filter((device: string): boolean =>
      devices.include.length > 0 ? !devices.include.includes(device) : devices.exclude.includes(device)
    )
    .map((device: string): string => DEVICES[device])
    .sort();
}

/**
 * Google's match type of a keyword of ours.
 *
 * @param matchType - Ours
 * @returns Google's
 */
export function googleMatchType(matchType: MatchType): string {
  return MATCH_TYPES[matchType];
}

/**
 * What tells two keywords of an ad group apart: their text, their match type, and whether they
 * exclude.
 *
 * @param text - The term
 * @param matchType - Google's match type
 * @param negative - Whether it excludes
 * @returns Its content key
 */
export function keywordKey(text: string, matchType: string, negative: boolean): string {
  return JSON.stringify([text.trim().toLowerCase(), matchType.toUpperCase(), negative]);
}

/**
 * The responsive search ad of a Line.
 *
 * @param line - The Line, as projected
 * @returns The ad
 * @throws PlatformError coded `google_ad_incomplete` for a Line with no creative or no page, which the
 *   preview refuses first
 */
export function searchAd(line: DesiredObject): GoogleAd {
  const payload = line.creative?.payload as
    { headlines: string[]; descriptions: string[]; displayPaths?: string[] } | undefined;
  if (!payload || line.landingPageUrl === null) {
    throw refusal(`The Line ${line.name} has no ad to send`, 'google_ad_incomplete', { line: line.name });
  }
  const [path1, path2] = payload.displayPaths ?? [];
  return {
    finalUrls: [line.landingPageUrl],
    urlCustomParameters: [{ key: MSKEY, value: line.nodeId }],
    responsiveSearchAd: {
      headlines: payload.headlines.map((text: string) => ({ text })),
      descriptions: payload.descriptions.map((text: string) => ({ text })),
      ...(path1 ? { path1 } : {}),
      ...(path1 && path2 ? { path2 } : {}),
    },
  };
}

/**
 * The Line an ad of ours stands for.
 *
 * @param ad - The ad, as Google reads it
 * @returns Its `mskey`, `null` for an ad we did not create
 */
export function lineOfAd(ad: GoogleAd | undefined): string | null {
  return ad?.urlCustomParameters?.find((parameter: { key: string }): boolean => parameter.key === MSKEY)?.value ?? null;
}

/**
 * Whether an ad over there says what a Line wants.
 *
 * @param current - The ad, as Google reads it
 * @param wanted - The ad the Line wants
 * @returns `true` when nothing has to change
 */
export function adMatches(current: GoogleAd, wanted: GoogleAd): boolean {
  const texts = (items: { text: string }[] | undefined): string =>
    JSON.stringify((items ?? []).map((item) => item.text));
  const ad = current.responsiveSearchAd;
  const target = wanted.responsiveSearchAd;
  return (
    JSON.stringify(current.finalUrls ?? []) === JSON.stringify(wanted.finalUrls) &&
    texts(ad?.headlines) === texts(target?.headlines) &&
    texts(ad?.descriptions) === texts(target?.descriptions) &&
    (ad?.path1 ?? '') === (target?.path1 ?? '') &&
    (ad?.path2 ?? '') === (target?.path2 ?? '')
  );
}

/**
 * One asset a campaign must show, in one role.
 *
 * @property key - What tells it apart: its role and its content, or the image it shows
 * @property fieldType - Its role at Google
 * @property asset - What to create, `null` for an image, which is uploaded on its own
 * @property image - The file of an image, `null` otherwise
 */
export type DesiredLink = {
  key: string;
  fieldType: string;
  asset: GoogleAsset | null;
  image: DesiredAsset | null;
};

/**
 * What tells two links of a campaign apart, from what Google reads of their asset.
 *
 * @param fieldType - The role
 * @param asset - The asset
 * @param image - The fingerprint of the image an image asset shows
 * @returns Its content key
 */
export function linkKey(fieldType: string, asset: GoogleAsset, image: string | null = null): string {
  switch (fieldType) {
    case 'SITELINK':
      return JSON.stringify([
        fieldType,
        asset.sitelinkAsset?.linkText ?? '',
        asset.sitelinkAsset?.description1 ?? '',
        asset.sitelinkAsset?.description2 ?? '',
        asset.finalUrls ?? [],
      ]);
    case 'CALLOUT':
      return JSON.stringify([fieldType, asset.calloutAsset?.calloutText ?? '']);
    case 'STRUCTURED_SNIPPET':
      return JSON.stringify([
        fieldType,
        asset.structuredSnippetAsset?.header ?? '',
        asset.structuredSnippetAsset?.values ?? [],
      ]);
    case 'BUSINESS_NAME':
      return JSON.stringify([fieldType, asset.textAsset?.text ?? '']);
    default:
      return JSON.stringify([fieldType, image]);
  }
}

/**
 * The tag an image carries in its name at Google: what finds it again instead of uploading it twice.
 *
 * @param image - The file
 * @returns `[op:<16 hexadecimal characters of its fingerprint>]`
 */
export function imageTag(image: DesiredAsset): string {
  return `[op:${image.fingerprint.slice(0, 16)}]`;
}

/**
 * Every asset a campaign must show: the extensions of the lever, and the brand of the first Line of
 * the campaign whose creative carries one (`docs/phase-10.md` § 8.4, points 6 and 7).
 *
 * @param extensions - The lever's
 * @param lines - The Lines of the campaign, in creation order
 * @returns The links, without duplicates
 */
export function desiredLinks(extensions: Extensions | null, lines: readonly DesiredObject[]): DesiredLink[] {
  const links: DesiredLink[] = [];
  const content = (fieldType: string, asset: GoogleAsset): void => {
    links.push({ key: linkKey(fieldType, asset), fieldType, asset, image: null });
  };
  for (const sitelink of extensions?.sitelinks ?? []) {
    const described: boolean = sitelink.description1 !== undefined && sitelink.description2 !== undefined;
    content('SITELINK', {
      finalUrls: [sitelink.finalUrl],
      sitelinkAsset: {
        linkText: sitelink.text,
        ...(described ? { description1: sitelink.description1, description2: sitelink.description2 } : {}),
      },
    });
  }
  for (const callout of extensions?.callouts ?? []) content('CALLOUT', { calloutAsset: { calloutText: callout } });
  for (const snippet of extensions?.structuredSnippets ?? []) {
    content('STRUCTURED_SNIPPET', {
      structuredSnippetAsset: { header: SNIPPET_HEADERS[snippet.header], values: [...snippet.values] },
    });
  }

  const businessName: string | undefined = lines
    .map((line: DesiredObject) => (line.creative?.payload as { businessName?: string } | undefined)?.businessName)
    .find((name: string | undefined): boolean => name !== undefined);
  if (businessName !== undefined) content('BUSINESS_NAME', { textAsset: { text: businessName } });
  for (const [role, fieldType] of [
    ['logo', 'BUSINESS_LOGO'],
    ['image', 'AD_IMAGE'],
  ] as const) {
    const image: DesiredAsset | undefined = lines
      .flatMap((line: DesiredObject): readonly DesiredAsset[] => line.creative?.assets ?? [])
      .find((asset: DesiredAsset): boolean => asset.role === role);
    // Keyed by the part of its fingerprint its name carries, which is what a read finds back.
    if (image)
      links.push({ key: linkKey(fieldType, {}, image.fingerprint.slice(0, 16)), fieldType, asset: null, image });
  }
  return links.filter(
    (link: DesiredLink, index: number): boolean =>
      links.findIndex((other: DesiredLink): boolean => other.key === link.key) === index
  );
}

/**
 * Temporary resource names, negative ids that later operations of one `mutate` refer to.
 */
export class TempIds {
  /** The last id handed out. */
  private last = 0;

  /**
   * @param customerId - The account changed
   */
  constructor(private readonly customerId: string) {}

  /**
   * A temporary resource name in a collection.
   *
   * @param collection - `campaigns`, `adGroups`, `assets`…
   * @returns `customers/<id>/<collection>/-<n>`
   */
  public next(collection: string): string {
    this.last -= 1;
    return `customers/${this.customerId}/${collection}/${this.last}`;
  }
}

/**
 * Our verdict of an ad, from what Google made of it — transcribed from multi-search
 * (`reviewOf`, `docs/phase-10.md` § 8.8).
 *
 * An ad under review, or under appeal, is `pending` whatever its last verdict: Google is looking at it
 * again. The reasons of a verdict are the policy topics behind it — those that forbid for a rejection,
 * those that limit for a limited one, every topic when none is of that kind —, each once, in Google's
 * order.
 *
 * @param summary - Its policy summary, as Google answers it
 * @returns The verdict
 *
 * @example
 * ```typescript
 * reviewOf({ approvalStatus: 'DISAPPROVED', policyTopicEntries: [{ topic: 'ALCOHOL', type: 'PROHIBITED' }] });
 * // { status: 'rejected', reasons: ['ALCOHOL'] }
 * ```
 */
export function reviewOf(summary: GooglePolicySummary | undefined): AdReview {
  if (summary?.reviewStatus === 'UNDER_APPEAL') return { status: 'pending', reasons: ['UNDER_APPEAL'] };
  if (summary === undefined || summary.reviewStatus === 'REVIEW_IN_PROGRESS') return { status: 'pending', reasons: [] };
  const status: ReviewStatus = APPROVAL_STATUSES.get(summary.approvalStatus ?? '') ?? 'pending';
  if (status === 'pending' || status === 'approved') return { status, reasons: [] };
  const entries: { topic?: string; type?: string }[] = summary.policyTopicEntries ?? [];
  const telling: { topic?: string; type?: string }[] = entries.filter((entry: { type?: string }): boolean =>
    status === 'rejected' ? entry.type === 'PROHIBITED' : LIMITING_TOPIC_TYPES.has(entry.type ?? '')
  );
  const topics: string[] = (telling.length > 0 ? telling : entries)
    .map((entry: { topic?: string }): string => entry.topic ?? '')
    .filter((topic: string): boolean => topic !== '');
  return { status, reasons: [...new Set(topics)] };
}
