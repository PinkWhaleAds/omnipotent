import { z } from 'zod';

import { snapshotSchema } from '@src/types';

/** Arguments of `get-me`: none. */
export const getMeInputSchema = z.strictObject({});

/** What `get-me` says of itself. */
export const getMeSchema = {
  title: 'Who am I',
  description:
    'Who you are, as omnipass resolved it: your user, your Seats, your Organizations with your role in each ' +
    'and their timezone, and the invitations waiting for your answer. Call it first: it gives the ' +
    'organizationId every other tool takes, and which roles you hold there',
  inputSchema: getMeInputSchema,
  outputSchema: snapshotSchema,
  annotations: { readOnlyHint: true },
};
