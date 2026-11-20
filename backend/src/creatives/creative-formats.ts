import { z } from 'zod';

import {
  AssetRole,
  CreativeFormat,
  CreativeFormatDescriptor,
  CreativeSubtype,
  creativeFormatSchema,
  creativeSubtypeSchema,
} from '@src/types';
import { httpError, toJsonSchema } from '@utils';

/**
 * @module creatives/creative-formats
 *
 * The registry of the couples `(format, subtype)`: what each one carries, and which assets it needs
 * (`../../CADRAGE.md` § 9, D37, `docs/phase-6.md` § 3).
 *
 * The **format** is the inventory a creative aims at, the **subtype** how it reaches the platform.
 * Each couple declares the schema of its payload and the **roles** of asset it expects, so requiring
 * the poster of a redirected VAST (G5) or the title of a native (L19) costs no test on a platform
 * name anywhere.
 *
 * What a **platform** accepts among these couples is `src/platforms/platform-rules.ts`, keyed
 * `(platform, lever)` (G6): this registry says what the model can express, that one says what a
 * platform takes, and the preview shows the loss.
 */

/** The limits of a responsive search ad, as multi-search has them from Google and Microsoft. */
export const SEARCH_AD_LIMITS = {
  minHeadlines: 3,
  maxHeadlines: 15,
  headlineLength: 30,
  minDescriptions: 2,
  maxDescriptions: 4,
  descriptionLength: 90,
  maxDisplayPaths: 2,
  pathLength: 15,
  businessNameLength: 25,
} as const;

/** How long a title, a body and a call to action of a native creative may be. */
const NATIVE_LIMITS = { titleLength: 90, bodyLength: 300, callToActionLength: 30 } as const;

/** A URL a third party serves a creative from. */
const thirdPartyUrlSchema = z.url({ protocol: /^https$/ }).max(2048);

/** What the registry says about one couple. */
export type CreativeFormatRules = {
  /** Its name, as the French front shows it without translating it. */
  label: string;
  /** The validation of its payload, the source of truth of its form. */
  payload: z.ZodType;
  /** The asset roles a version of it must carry. */
  requiredRoles: readonly AssetRole[];
  /** Those it may carry. */
  optionalRoles: readonly AssetRole[];
};

/** The key of the registry: the couple, as a route and a message spell it. */
type CoupleKey = `${CreativeFormat}:${CreativeSubtype}`;

/**
 * Every couple the model knows, with what it carries.
 *
 * `(display, html5)` and `(display, script_tag)` are **absent on purpose** (L20): no platform of our
 * references accepts them, and a couple nobody takes fails every preview while serving no one. The
 * day a platform study finds one, it is one entry here.
 */
export const CREATIVE_FORMATS: Readonly<Partial<Record<CoupleKey, CreativeFormatRules>>> = {
  'search_text:rsa': {
    label: 'Annonce textuelle responsive',
    payload: z.strictObject({
      headlines: z
        .array(z.string().trim().min(1).max(SEARCH_AD_LIMITS.headlineLength))
        .min(SEARCH_AD_LIMITS.minHeadlines)
        .max(SEARCH_AD_LIMITS.maxHeadlines),
      descriptions: z
        .array(z.string().trim().min(1).max(SEARCH_AD_LIMITS.descriptionLength))
        .min(SEARCH_AD_LIMITS.minDescriptions)
        .max(SEARCH_AD_LIMITS.maxDescriptions),
      displayPaths: z
        .array(z.string().trim().min(1).max(SEARCH_AD_LIMITS.pathLength))
        .max(SEARCH_AD_LIMITS.maxDisplayPaths)
        .default([]),
      // The brand, as multi-search carries it: shown beside the ad where the platform allows it
      // (`docs/phase-10.md` § 8.4, point 7).
      businessName: z.string().trim().min(1).max(SEARCH_AD_LIMITS.businessNameLength).optional(),
    }),
    requiredRoles: [],
    optionalRoles: ['logo', 'image'],
  },
  'display:image': {
    label: 'Display image',
    payload: z.strictObject({ altText: z.string().trim().min(1).max(255).optional() }),
    requiredRoles: ['image'],
    optionalRoles: ['logo'],
  },
  'display:mraid': {
    label: 'Display rich media (MRAID)',
    payload: z.strictObject({ entryFile: z.string().trim().min(1).max(255) }),
    requiredRoles: ['bundle'],
    optionalRoles: ['thumbnail'],
  },
  'video:file': {
    label: 'Vidéo hébergée',
    payload: z.strictObject({}),
    requiredRoles: ['video'],
    optionalRoles: ['thumbnail'],
  },
  'video:vast_url': {
    // Hawk refuses a redirected VAST without a poster (G5), so the role is required by the model.
    label: 'VAST tiers (redirection)',
    payload: z.strictObject({ vastUrl: thirdPartyUrlSchema }),
    requiredRoles: ['thumbnail'],
    optionalRoles: [],
  },
  'video:youtube_id': {
    // The Demand Gen path of DV360 takes an identifier and no bytes at all (L20).
    label: 'Vidéo YouTube',
    payload: z.strictObject({
      youtubeVideoId: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9_-]{11}$/, 'A YouTube video id holds eleven characters'),
    }),
    requiredRoles: [],
    optionalRoles: ['thumbnail'],
  },
  'audio:file': {
    label: 'Audio hébergé',
    payload: z.strictObject({}),
    requiredRoles: ['audio'],
    optionalRoles: ['image'],
  },
  'audio:vast_url': {
    label: 'VAST/DAAST audio tiers',
    payload: z.strictObject({ vastUrl: thirdPartyUrlSchema }),
    requiredRoles: [],
    optionalRoles: ['image'],
  },
  'native:assets': {
    // The title is required (L19): the OpenRTB `title` asset is what a native is built around.
    label: 'Native',
    payload: z.strictObject({
      title: z.string().trim().min(1).max(NATIVE_LIMITS.titleLength),
      body: z.string().trim().min(1).max(NATIVE_LIMITS.bodyLength).optional(),
      callToAction: z.string().trim().min(1).max(NATIVE_LIMITS.callToActionLength).optional(),
    }),
    requiredRoles: ['image'],
    optionalRoles: ['logo', 'icon'],
  },
};

/**
 * The couples of the registry, in the order it declares them.
 *
 * @returns The couples
 *
 * @example
 * ```typescript
 * allCouples().length; // what the model can express today
 * ```
 */
export function allCouples(): { format: CreativeFormat; subtype: CreativeSubtype }[] {
  return Object.keys(CREATIVE_FORMATS).map((key: string): { format: CreativeFormat; subtype: CreativeSubtype } => {
    const [format, subtype] = key.split(':');
    return { format: format as CreativeFormat, subtype: subtype as CreativeSubtype };
  });
}

/**
 * The rules of one couple.
 *
 * @param format - The inventory it aims at
 * @param subtype - How it reaches the platform
 * @returns Its rules
 * @throws Error with status 400 coded `creative_couple_unknown` when the registry has no such couple
 *
 * @example
 * ```typescript
 * rulesOfCouple('display', 'image').requiredRoles; // ['image']
 * rulesOfCouple('display', 'mraid'); // fine
 * ```
 */
export function rulesOfCouple(format: CreativeFormat, subtype: CreativeSubtype): CreativeFormatRules {
  const rules: CreativeFormatRules | undefined = CREATIVE_FORMATS[`${format}:${subtype}`];
  if (!rules) {
    throw httpError(400, `The model knows no ${format} creative arriving as ${subtype}`, {
      code: 'creative_couple_unknown',
      params: { format, subtype },
    });
  }
  return rules;
}

/**
 * Validate the payload of a version, and answer it with its defaults applied.
 *
 * The **only** door to the payload schemas: there is one place where a payload is judged, and one
 * error code for the whole family of refusals.
 *
 * @param format - The inventory it aims at
 * @param subtype - How it reaches the platform
 * @param payload - What the caller sent
 * @returns The payload, parsed
 * @throws Error with status 400 coded `creative_payload_invalid`, or `creative_couple_unknown`
 *
 * @example
 * ```typescript
 * parsePayload('video', 'vast_url', { vastUrl: 'https://vast.test/tag.xml' });
 * ```
 */
export function parsePayload(format: CreativeFormat, subtype: CreativeSubtype, payload: unknown): object {
  const parsed: z.ZodSafeParseResult<unknown> = rulesOfCouple(format, subtype).payload.safeParse(payload);
  if (!parsed.success) {
    const reason: string = parsed.error.issues.map((issue: z.core.$ZodIssue): string => issue.message).join('; ');
    throw httpError(400, `The payload of this ${format} creative does not hold: ${reason}`, {
      code: 'creative_payload_invalid',
      params: { format, subtype, reason },
    });
  }
  return parsed.data as object;
}

/**
 * Refuse a set of asset roles a couple does not expect, or that misses one it needs.
 *
 * @param format - The inventory it aims at
 * @param subtype - How it reaches the platform
 * @param roles - The roles the version carries
 * @returns Nothing
 * @throws Error with status 400 coded `creative_asset_role_missing` or `creative_asset_role_unknown`
 *
 * @example
 * ```typescript
 * assertRoles('display', 'image', ['image']); // fine
 * assertRoles('display', 'image', []); // throws, naming the image role
 * ```
 */
export function assertRoles(format: CreativeFormat, subtype: CreativeSubtype, roles: readonly AssetRole[]): void {
  const rules: CreativeFormatRules = rulesOfCouple(format, subtype);
  const carried = new Set<AssetRole>(roles);
  for (const role of rules.requiredRoles) {
    if (!carried.has(role)) {
      throw httpError(400, `A ${format} creative arriving as ${subtype} needs its ${role}`, {
        code: 'creative_asset_role_missing',
        params: { role, format, subtype },
      });
    }
  }
  const accepted = new Set<AssetRole>([...rules.requiredRoles, ...rules.optionalRoles]);
  for (const role of carried) {
    if (!accepted.has(role)) {
      throw httpError(400, `A ${format} creative arriving as ${subtype} has nothing to do with a ${role}`, {
        code: 'creative_asset_role_unknown',
        params: { role, format, subtype },
      });
    }
  }
}

/**
 * The registry as the discovery route answers it: the couples, and the shape of each payload.
 *
 * The JSON Schema travels with the descriptor so that nothing — a front, a model, a test — holds a
 * copy of a form that lives here.
 *
 * @returns One descriptor per couple
 */
export function creativeCatalog(): CreativeFormatDescriptor[] {
  return allCouples().map(
    ({ format, subtype }: { format: CreativeFormat; subtype: CreativeSubtype }): CreativeFormatDescriptor => {
      const rules: CreativeFormatRules = rulesOfCouple(format, subtype);
      return {
        format,
        subtype,
        label: rules.label,
        requiredRoles: [...rules.requiredRoles],
        optionalRoles: [...rules.optionalRoles],
        payloadSchema: toJsonSchema(rules.payload, 'input') as Record<string, unknown>,
      };
    }
  );
}

/**
 * Every format and every subtype the enumerations hold, whether or not a couple uses them.
 *
 * Read by the tests that prove the registry and the enumerations agree: a subtype nobody couples is
 * a subtype nobody can send.
 *
 * @returns The two enumerations
 */
export function declaredDiscriminants(): { formats: CreativeFormat[]; subtypes: CreativeSubtype[] } {
  return { formats: [...creativeFormatSchema.options], subtypes: [...creativeSubtypeSchema.options] };
}
