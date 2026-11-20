import { DesiredAsset, DesiredObject, DesiredUnit } from '@src/platforms/desired-state';
import { geoTargetConstant } from '@src/platforms/google/google-geo';
import {
  adGroupCpcBid,
  adMatches,
  campaignBidding,
  campaignCriteria,
  campaignSlots,
  criterionKey,
  desiredLinks,
  endDateTime,
  excludedDevices,
  geoTargetTypeSetting,
  googleMatchType,
  googleStatus,
  imageTag,
  implicitAdGroupKey,
  keywordKey,
  lineOfAd,
  linkKey,
  nameTag,
  networkSettings,
  refusal,
  reviewOf,
  roundMicros,
  searchAd,
  startDateTime,
  taggedName,
  TempIds,
  wallClock,
} from '@src/platforms/google/google.mapping';
import { GoogleAd } from '@src/platforms/google/google.types';
import { PlatformError } from '@src/platforms/platform-adapter';

/** 2027-01-04 10:00 UTC, 11:00 in Paris. */
const NOW: number = Date.parse('2027-01-04T10:00:00.000Z');

/**
 * One projected object with everything a platform needs, as the desired state builds it.
 *
 * @param key - Its key
 * @param object - Google's kind
 * @param overrides - What this case declares
 * @returns The object
 */
function object(key: string, object: DesiredObject['object'], overrides: Partial<DesiredObject> = {}): DesiredObject {
  return {
    key,
    level: 'line',
    nodeId: key.split(':').pop() as string,
    keywordId: null,
    object,
    parentKey: null,
    split: false,
    name: key,
    status: 'active',
    startsOn: '2027-01-04',
    endsOn: '2027-01-10',
    dailyBudgetMicros: null,
    bidMicros: null,
    bidStrategy: null,
    capping: null,
    targeting: null,
    creative: null,
    landingPageUrl: null,
    trackers: null,
    keyword: null,
    ...overrides,
  };
}

/** A responsive search ad's texts. */
const RSA = { headlines: ['Lits', 'Chêne', 'Herbéa'], descriptions: ['Fabriqués en France', 'Livrés'] };

/**
 * A Line carrying a responsive search ad.
 *
 * @param id - Its id
 * @param payload - What its creative says, beyond the texts
 * @param assets - The files it shows
 * @returns The Line
 */
function line(id: string, payload: object = {}, assets: DesiredAsset[] = []): DesiredObject {
  return object(`line:${id}`, 'ad', {
    landingPageUrl: 'https://herbea.test/lits',
    creative: {
      versionId: 'v1',
      format: 'search_text',
      subtype: 'rsa',
      payload: { ...RSA, ...payload },
      assets,
    },
  });
}

/**
 * A file of a creative.
 *
 * @param role - Its role
 * @param fingerprint - Its content's fingerprint
 * @returns The file
 */
function file(role: DesiredAsset['role'], fingerprint: string): DesiredAsset {
  return {
    role,
    id: `asset-${fingerprint}`,
    fingerprint,
    fileName: `${role}.png`,
    mimeType: 'image/png',
    width: 512,
    height: 512,
  };
}

describe('Unit::Platforms::Google::Mapping', () => {
  describe('refusal', () => {
    it('should be our own refusal, never worth retrying', (): void => {
      const error: PlatformError = refusal('No', 'google_no', { reason: 'x' });

      expect(error).toBeInstanceOf(PlatformError);
      expect(error.platform).toBe('google_ads');
      expect(error.options).toMatchObject({
        retryable: false,
        messageCode: 'google_no',
        messageParams: { reason: 'x' },
      });
      expect(refusal('No', 'google_no').options.messageParams).toEqual({});
    });
  });

  describe('campaignSlots', () => {
    it('should give each campaign its ad groups, and each ad group its ads and keywords', (): void => {
      const desired = {
        objects: [
          object('ad_group:g1', 'campaign'),
          object('targeting_group:t1', 'ad_group', { parentKey: 'ad_group:g1' }),
          object('keyword:k1', 'keyword', { parentKey: 'targeting_group:t1' }),
          object('line:l1', 'ad', { parentKey: 'targeting_group:t1' }),
          object('split:targeting_group:t2', 'campaign'),
          object('targeting_group:t2', 'ad_group', { parentKey: 'split:targeting_group:t2' }),
        ],
      } as unknown as DesiredUnit;

      const slots = campaignSlots(desired);

      expect(slots.map((slot) => [slot.key, slot.adGroups.map((group) => group.key)])).toEqual([
        ['ad_group:g1', ['targeting_group:t1']],
        ['split:targeting_group:t2', ['targeting_group:t2']],
      ]);
      expect(slots[0].adGroups[0].ads.map((ad) => ad.key)).toEqual(['line:l1']);
      expect(slots[0].adGroups[0].keywords.map((keyword) => keyword.key)).toEqual(['keyword:k1']);
    });
  });

  describe('campaignSlots, a TargetingGroup that is both campaign and ad group (D55)', () => {
    it('should give the campaign its own implicit ad group, holding its ads and keywords', (): void => {
      const desired = {
        objects: [
          object('targeting_group:t1', 'campaign'),
          object('keyword:k1', 'keyword', { parentKey: 'targeting_group:t1' }),
          object('line:l1', 'ad', { parentKey: 'targeting_group:t1' }),
          object('targeting_group:t2', 'campaign'),
          object('line:l2', 'ad', { parentKey: 'targeting_group:t2' }),
        ],
      } as unknown as DesiredUnit;

      const slots = campaignSlots(desired);

      expect(slots.map((slot) => [slot.key, slot.adGroups.map((group) => group.key)])).toEqual([
        ['targeting_group:t1', [implicitAdGroupKey('targeting_group:t1')]],
        ['targeting_group:t2', ['targeting_group:t2#ad_group']],
      ]);
      expect(slots[0].adGroups[0].adGroup).toBe(slots[0].campaign);
      expect(slots[0].adGroups[0].ads.map((ad) => ad.key)).toEqual(['line:l1']);
      expect(slots[0].adGroups[0].keywords.map((keyword) => keyword.key)).toEqual(['keyword:k1']);
    });
  });

  describe('names', () => {
    it('should tag a name with the unit and the key, the same each time', (): void => {
      expect(nameTag('u1', 'ad_group:g1')).toMatch(/^\[op:[0-9a-f]{12}\]$/);
      expect(nameTag('u1', 'ad_group:g1')).toBe(nameTag('u1', 'ad_group:g1'));
      expect(nameTag('u1', 'ad_group:g2')).not.toBe(nameTag('u1', 'ad_group:g1'));
    });

    it('should keep the tag whole however long the name', (): void => {
      expect(taggedName('Automne', '[op:abc]')).toBe('Automne [op:abc]');
      const long: string = taggedName('x'.repeat(300), '[op:abc]');
      expect(long).toHaveLength(255);
      expect(long.endsWith(' [op:abc]')).toBe(true);
    });
  });

  describe('amounts and dates', () => {
    it('should round micros to the smallest unit of the currency, never under it', (): void => {
      expect(roundMicros(12_345_678, 'EUR')).toBe(12_350_000);
      expect(roundMicros(1_499_999, 'jpy')).toBe(1_000_000);
      expect(roundMicros(0, 'EUR')).toBe(10_000);
    });

    it('should read the wall clock of an instant in a timezone', (): void => {
      expect(wallClock(NOW, 'Europe/Paris')).toBe('2027-01-04 11:00:00');
    });

    it('should send a start only while it is to come in the account timezone', (): void => {
      expect(startDateTime('2027-01-05', 'Europe/Paris', NOW)).toBe('2027-01-05 00:00:00');
      expect(startDateTime('2027-01-04', 'Europe/Paris', NOW)).toBeNull();
    });

    it('should send an end only while it is to come', (): void => {
      expect(endDateTime('2027-01-04', 'Europe/Paris', NOW)).toBe('2027-01-04 23:59:59');
      expect(endDateTime('2027-01-03', 'Europe/Paris', NOW)).toBeNull();
    });

    it('should say ENABLED or PAUSED', (): void => {
      expect(googleStatus('active')).toBe('ENABLED');
      expect(googleStatus('paused')).toBe('PAUSED');
    });
  });

  describe('bidding', () => {
    it('should bid by hand under max_cpc, and let Google maximize the clicks under a ceiling', (): void => {
      expect(campaignBidding('max_cpc', 500_000, 'EUR')).toEqual({ manualCpc: { enhancedCpcEnabled: false } });
      expect(campaignBidding('maximize_clicks', 1_234_567, 'EUR')).toEqual({
        targetSpend: { cpcBidCeilingMicros: '1230000' },
      });
      expect(campaignBidding('maximize_clicks', null, 'EUR')).toEqual({ targetSpend: {} });
    });

    it('should refuse a strategy Google Search does not bid with here', (): void => {
      expect((): unknown => campaignBidding('cpm', null, 'EUR')).toThrow(
        expect.objectContaining({
          options: expect.objectContaining({ messageCode: 'google_bid_strategy_unsupported' }),
        })
      );
      expect((): unknown => campaignBidding(null, null, 'EUR')).toThrow(PlatformError);
    });

    it('should give an ad group its maximum bid under max_cpc only', (): void => {
      expect(adGroupCpcBid('max_cpc', 456_789, 'EUR')).toBe('460000');
      expect(adGroupCpcBid('maximize_clicks', 456_789, 'EUR')).toBeUndefined();
      expect((): unknown => adGroupCpcBid('max_cpc', null, 'EUR')).toThrow(
        expect.objectContaining({ options: expect.objectContaining({ messageCode: 'google_bid_required' }) })
      );
    });
  });

  describe('settings', () => {
    it('should show on Google Search always, on its partners as the lever says', (): void => {
      expect(networkSettings({ searchPartners: true })).toEqual({
        targetGoogleSearch: true,
        targetSearchNetwork: true,
        targetContentNetwork: false,
        targetPartnerSearchNetwork: false,
      });
      expect(networkSettings({}).targetSearchNetwork).toBe(false);
    });

    it('should reach the people in a place, or also those interested in it', (): void => {
      expect(geoTargetTypeSetting('presence')).toEqual({
        positiveGeoTargetType: 'PRESENCE',
        negativeGeoTargetType: 'PRESENCE',
      });
      expect(geoTargetTypeSetting('presence_or_interest').positiveGeoTargetType).toBe('PRESENCE_OR_INTEREST');
    });
  });

  describe('targeting', () => {
    const CAMPAIGN = 'customers/1/campaigns/-1';

    it('should target countries and circles, and exclude countries', (): void => {
      const criteria = campaignCriteria(
        {
          country: { include: ['FR'], exclude: ['MC', 'XX'] },
          proximity: { points: [{ latitude: 48.8566, longitude: 2.3522, radiusKm: 10 }] },
        },
        CAMPAIGN
      );

      expect(criteria).toEqual([
        { campaign: CAMPAIGN, location: { geoTargetConstant: 'geoTargetConstants/2250' } },
        { campaign: CAMPAIGN, negative: true, location: { geoTargetConstant: geoTargetConstant('MC') } },
        {
          campaign: CAMPAIGN,
          proximity: {
            geoPoint: { latitudeInMicroDegrees: 48_856_600, longitudeInMicroDegrees: 2_352_200 },
            radius: 10,
            radiusUnits: 'KILOMETERS',
          },
        },
      ]);
    });

    it('should target nothing for a node that restricts nothing', (): void => {
      expect(campaignCriteria(null, CAMPAIGN)).toEqual([]);
      expect(campaignCriteria({ country: { exclude: ['FR'] } }, CAMPAIGN)).toHaveLength(1);
    });

    it('should refuse an included country Google does not target', (): void => {
      expect((): unknown => campaignCriteria({ country: { include: ['XX'] } }, CAMPAIGN)).toThrow(
        expect.objectContaining({
          options: expect.objectContaining({
            messageCode: 'google_country_unsupported',
            messageParams: { country: 'XX' },
          }),
        })
      );
    });

    it('should tell two criteria apart by their content', (): void => {
      expect(criterionKey({ location: { geoTargetConstant: 'geoTargetConstants/2250' } })).toBe(
        criterionKey({ negative: false, location: { geoTargetConstant: 'geoTargetConstants/2250' } })
      );
      expect(criterionKey({ negative: true, location: { geoTargetConstant: 'geoTargetConstants/2250' } })).not.toBe(
        criterionKey({ location: { geoTargetConstant: 'geoTargetConstants/2250' } })
      );
      expect(
        criterionKey({ proximity: { geoPoint: { latitudeInMicroDegrees: 1, longitudeInMicroDegrees: 2 }, radius: 3 } })
      ).toBe(JSON.stringify(['proximity', 1, 2, 3]));
      expect(criterionKey({})).toBe(JSON.stringify(['proximity', null, null, null]));
    });

    it('should leave out the devices a node does not include, or the ones it excludes', (): void => {
      expect(excludedDevices({ device: { include: ['mobile'], exclude: [] } })).toEqual(['DESKTOP', 'TABLET']);
      expect(excludedDevices({ device: { include: [], exclude: ['tablet', 'ctv'] } })).toEqual(['TABLET']);
      expect(excludedDevices(null)).toEqual([]);
    });
  });

  describe('keywords', () => {
    it('should name the match type as Google does, and tell two keywords apart', (): void => {
      expect(googleMatchType('phrase')).toBe('PHRASE');
      expect(keywordKey(' Lit Chêne ', 'exact', false)).toBe(JSON.stringify(['lit chêne', 'EXACT', false]));
    });
  });

  describe('ads', () => {
    it('should write the ad of a Line, its mskey naming it', (): void => {
      expect(searchAd(line('l1', { displayPaths: ['lits', 'chene'] }))).toEqual({
        finalUrls: ['https://herbea.test/lits'],
        urlCustomParameters: [{ key: 'mskey', value: 'l1' }],
        responsiveSearchAd: {
          headlines: [{ text: 'Lits' }, { text: 'Chêne' }, { text: 'Herbéa' }],
          descriptions: [{ text: 'Fabriqués en France' }, { text: 'Livrés' }],
          path1: 'lits',
          path2: 'chene',
        },
      });
      expect(searchAd(line('l1', { displayPaths: ['lits'] })).responsiveSearchAd).not.toHaveProperty('path2');
      expect(searchAd(line('l1')).responsiveSearchAd).not.toHaveProperty('path1');
    });

    it('should refuse a Line with no creative, or nowhere to click', (): void => {
      expect((): unknown => searchAd(object('line:l1', 'ad', { landingPageUrl: 'https://herbea.test' }))).toThrow(
        expect.objectContaining({ options: expect.objectContaining({ messageCode: 'google_ad_incomplete' }) })
      );
      expect((): unknown => searchAd({ ...line('l1'), landingPageUrl: null })).toThrow(PlatformError);
    });

    it('should read which Line an ad stands for', (): void => {
      expect(lineOfAd(searchAd(line('l1')))).toBe('l1');
      expect(lineOfAd({ urlCustomParameters: [{ key: 'other', value: 'x' }] })).toBeNull();
      expect(lineOfAd({})).toBeNull();
      expect(lineOfAd(undefined)).toBeNull();
    });

    it('should tell an ad that says what the Line wants from one that does not', (): void => {
      const wanted: GoogleAd = searchAd(line('l1', { displayPaths: ['lits', 'chene'] }));

      expect(adMatches(wanted, wanted)).toBe(true);
      expect(adMatches({ ...wanted, finalUrls: ['https://other.test'] }, wanted)).toBe(false);
      expect(adMatches({}, searchAd(line('l1')))).toBe(false);
      expect(
        adMatches(
          { finalUrls: wanted.finalUrls, responsiveSearchAd: { headlines: [], descriptions: [] } },
          { finalUrls: wanted.finalUrls }
        )
      ).toBe(true);
    });
  });

  describe('assets', () => {
    it('should tell two links apart by their role and their content', (): void => {
      expect(linkKey('SITELINK', {})).toBe(JSON.stringify(['SITELINK', '', '', '', []]));
      expect(linkKey('CALLOUT', {})).toBe(JSON.stringify(['CALLOUT', '']));
      expect(linkKey('STRUCTURED_SNIPPET', {})).toBe(JSON.stringify(['STRUCTURED_SNIPPET', '', []]));
      expect(linkKey('BUSINESS_NAME', {})).toBe(JSON.stringify(['BUSINESS_NAME', '']));
      expect(linkKey('BUSINESS_LOGO', {}, 'abc')).toBe(JSON.stringify(['BUSINESS_LOGO', 'abc']));
      expect(linkKey('AD_IMAGE', {})).toBe(JSON.stringify(['AD_IMAGE', null]));
    });

    it('should tag an image with its fingerprint', (): void => {
      expect(imageTag(file('logo', 'a'.repeat(64)))).toBe(`[op:${'a'.repeat(16)}]`);
    });

    it('should link the extensions of the lever, and the brand of the first Line that has one', (): void => {
      const logo: DesiredAsset = file('logo', 'f1');
      const links = desiredLinks(
        {
          sitelinks: [
            { text: 'Nos lits', finalUrl: 'https://herbea.test/lits' },
            {
              text: 'Nos draps',
              description1: 'En lin',
              description2: 'Et en coton',
              finalUrl: 'https://herbea.test/draps',
            },
            { text: 'Nos lits', finalUrl: 'https://herbea.test/lits' },
          ],
          callouts: ['Livraison offerte'],
          structuredSnippets: [{ header: 'service_catalog', values: ['Lits', 'Draps', 'Oreillers'] }],
        },
        [line('l0'), line('l1', { businessName: 'Herbéa' }, [logo]), line('l2', { businessName: 'Autre' })]
      );

      expect(links.map((link) => [link.fieldType, link.asset, link.image?.fingerprint ?? null])).toEqual([
        ['SITELINK', { finalUrls: ['https://herbea.test/lits'], sitelinkAsset: { linkText: 'Nos lits' } }, null],
        [
          'SITELINK',
          {
            finalUrls: ['https://herbea.test/draps'],
            sitelinkAsset: { linkText: 'Nos draps', description1: 'En lin', description2: 'Et en coton' },
          },
          null,
        ],
        ['CALLOUT', { calloutAsset: { calloutText: 'Livraison offerte' } }, null],
        [
          'STRUCTURED_SNIPPET',
          { structuredSnippetAsset: { header: 'Services', values: ['Lits', 'Draps', 'Oreillers'] } },
          null,
        ],
        ['BUSINESS_NAME', { textAsset: { text: 'Herbéa' } }, null],
        ['BUSINESS_LOGO', null, 'f1'],
      ]);
    });

    it('should link nothing for a lever with no extension and Lines with no brand', (): void => {
      expect(desiredLinks(null, [line('l1'), object('line:l2', 'ad')])).toEqual([]);
    });
  });

  describe('TempIds', () => {
    it('should hand out negative ids, one after the other', (): void => {
      const ids = new TempIds('123');

      expect(ids.next('campaigns')).toBe('customers/123/campaigns/-1');
      expect(ids.next('adGroups')).toBe('customers/123/adGroups/-2');
    });
  });

  describe('reviewOf', () => {
    it('should read an ad still under review, or never reviewed, as pending', (): void => {
      expect(reviewOf(undefined)).toEqual({ status: 'pending', reasons: [] });
      expect(reviewOf({ reviewStatus: 'REVIEW_IN_PROGRESS', approvalStatus: 'APPROVED' })).toEqual({
        status: 'pending',
        reasons: [],
      });
      expect(reviewOf({ reviewStatus: 'REVIEWED', approvalStatus: 'UNKNOWN' })).toEqual({
        status: 'pending',
        reasons: [],
      });
      expect(reviewOf({ reviewStatus: 'ELIGIBLE_MAY_SERVE' })).toEqual({ status: 'pending', reasons: [] });
    });

    it('should read an appeal as pending, and say so', (): void => {
      expect(reviewOf({ reviewStatus: 'UNDER_APPEAL', approvalStatus: 'DISAPPROVED' })).toEqual({
        status: 'pending',
        reasons: ['UNDER_APPEAL'],
      });
    });

    it('should read an approved ad, with no reason', (): void => {
      expect(
        reviewOf({
          reviewStatus: 'REVIEWED',
          approvalStatus: 'APPROVED',
          policyTopicEntries: [{ topic: 'ANYTHING', type: 'LIMITED' }],
        })
      ).toEqual({ status: 'approved', reasons: [] });
    });

    it('should give the topics that forbid a rejected ad, each once', (): void => {
      expect(
        reviewOf({
          reviewStatus: 'REVIEWED',
          approvalStatus: 'DISAPPROVED',
          policyTopicEntries: [
            { topic: 'TRADEMARKS_IN_AD_TEXT', type: 'PROHIBITED' },
            { topic: 'ALCOHOL', type: 'LIMITED' },
            { topic: 'TRADEMARKS_IN_AD_TEXT', type: 'PROHIBITED' },
            { type: 'PROHIBITED' },
          ],
        })
      ).toEqual({ status: 'rejected', reasons: ['TRADEMARKS_IN_AD_TEXT'] });
    });

    it('should give the topics that limit a limited ad, and every topic when none is of that kind', (): void => {
      expect(
        reviewOf({
          approvalStatus: 'APPROVED_LIMITED',
          policyTopicEntries: [
            { topic: 'ALCOHOL', type: 'LIMITED' },
            { topic: 'GAMBLING', type: 'FULLY_LIMITED' },
            { topic: 'SOMETHING', type: 'DESCRIPTIVE' },
          ],
        })
      ).toEqual({ status: 'limited', reasons: ['ALCOHOL', 'GAMBLING'] });
      expect(
        reviewOf({
          approvalStatus: 'AREA_OF_INTEREST_ONLY',
          policyTopicEntries: [{ topic: 'LOCAL', type: 'DESCRIPTIVE' }],
        })
      ).toEqual({ status: 'limited', reasons: ['LOCAL'] });
      expect(reviewOf({ approvalStatus: 'DISAPPROVED' })).toEqual({ status: 'rejected', reasons: [] });
    });
  });
});
