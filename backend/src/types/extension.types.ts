import { z } from 'zod';

import { platformSchema } from './platform.types';

/**
 * What a Search campaign shows around its ads, and how it reads a place — transcribed from
 * multi-search (`types/campaign.types.ts` and `types/ad-group.types.ts` there,
 * `docs/phase-10.md` § 8.4, points 5 and 6).
 */

/** How long an extension's text is, as Google and Microsoft accept it. */
const EXTENSION_TEXT = z.string().trim().min(1).max(25);

/** How long a sitelink's description line is. */
const SITELINK_DESCRIPTION = z.string().trim().min(1).max(35);

/**
 * The headers a structured snippet may carry: Google and Microsoft share this list, each in its own
 * words (the adapters translate it).
 */
export const snippetHeaderSchema = z.enum([
  'amenities',
  'brands',
  'courses',
  'degree_programs',
  'destinations',
  'featured_hotels',
  'insurance_coverage',
  'models',
  'neighborhoods',
  'service_catalog',
  'shows',
  'styles',
  'types',
]);

/** TypeScript type inferred from {@link snippetHeaderSchema}. */
export type SnippetHeader = z.infer<typeof snippetHeaderSchema>;

/**
 * Zod schema of one sitelink.
 *
 * @property text - What the link says
 * @property description1 - Its first description line; the platforms take the two lines or none, which
 *   the preview checks rather than the entry (`../../CADRAGE.md` § 13)
 * @property description2 - Its second one
 * @property finalUrl - Where it leads
 */
export const sitelinkSchema = z.strictObject({
  text: EXTENSION_TEXT,
  description1: SITELINK_DESCRIPTION.optional(),
  description2: SITELINK_DESCRIPTION.optional(),
  finalUrl: z.url({ protocol: /^https?$/ }).max(2048),
});

/** TypeScript type inferred from {@link sitelinkSchema}. */
export type Sitelink = z.infer<typeof sitelinkSchema>;

/**
 * Zod schema of one structured snippet.
 *
 * @property header - What its values are
 * @property values - Three to ten of them
 */
export const structuredSnippetSchema = z.strictObject({
  header: snippetHeaderSchema,
  values: z.array(EXTENSION_TEXT).min(3).max(10),
});

/** TypeScript type inferred from {@link structuredSnippetSchema}. */
export type StructuredSnippet = z.infer<typeof structuredSnippetSchema>;

/**
 * Zod schema of the extensions of a Lever: every platform campaign of the lever receives them all.
 *
 * @property sitelinks - Links under the ad, twenty at most
 * @property callouts - Short phrases, twenty at most
 * @property structuredSnippets - Lists of values under a header, ten at most
 */
export const extensionsSchema = z.strictObject({
  sitelinks: z.array(sitelinkSchema).max(20).default([]),
  callouts: z.array(EXTENSION_TEXT).max(20).default([]),
  structuredSnippets: z.array(structuredSnippetSchema).max(10).default([]),
});

/** TypeScript type inferred from {@link extensionsSchema}, after defaults apply. */
export type Extensions = z.infer<typeof extensionsSchema>;

/**
 * Who a targeted place reaches: the people **in** it, or also those **interested** in it — searching
 * for it, reading about it. An excluded place always excludes the people in it.
 */
export const locationIntentSchema = z.enum(['presence', 'presence_or_interest']);

/** TypeScript type inferred from {@link locationIntentSchema}. */
export type LocationIntent = z.infer<typeof locationIntentSchema>;

/** The name of one setting a platform declares for a lever, as the registry spells it. */
const SETTING_NAME = z.string().regex(/^[a-z][a-zA-Z]{0,63}$/, 'A setting is named in camelCase, e.g. searchPartners');

/**
 * Zod schema of the settings of a Lever, platform by platform: only those the registry declares for
 * the couple are accepted, and each one left out takes the platform's default
 * (`docs/phase-10.md` § 8.4, point 4).
 */
export const platformSettingsSchema = z.partialRecord(platformSchema, z.record(SETTING_NAME, z.boolean()));

/** TypeScript type inferred from {@link platformSettingsSchema}. */
export type PlatformSettings = z.infer<typeof platformSettingsSchema>;
