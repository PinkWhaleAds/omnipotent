import { z } from 'zod';

import { advertiserTrackingSchema, organizationArgSchema } from '@src/types';

/** Input of `get-tracking`. */
export const getTrackingInputSchema = z.strictObject({
  organizationId: organizationArgSchema,
  advertiserId: z.uuid().describe('Advertiser id (from list-advertisers)'),
});

/** TypeScript type inferred from {@link getTrackingInputSchema}. */
export type GetTrackingInput = z.infer<typeof getTrackingInputSchema>;

/** MCP tool schema for `get-tracking`. */
export const getTrackingSchema = {
  title: 'Get the tracking of an Advertiser',
  description:
    'The one snippet to paste in the <head> of every page of the site of an Advertiser, the domains its ' +
    'Content Security Policy must allow, when its site last loaded the script (lastSeenAt: whether the ' +
    'code is installed), and, per account it uses, where its tracking code and each conversion goal ' +
    "stand. Nothing is loaded nor sent before the site calls msq('consent', { ads: 'granted' }) from its " +
    "consent banner; a conversion is msq('conversion', { goal: '<key>', value: 89.0, currency: 'EUR', " +
    'orderId }). A goal failed or waiting for someone is set up again every half hour. The first call ' +
    'gives the Advertiser the public key of its script. Requires the viewer role',
  inputSchema: getTrackingInputSchema,
  outputSchema: advertiserTrackingSchema,
  annotations: { readOnlyHint: true },
};
