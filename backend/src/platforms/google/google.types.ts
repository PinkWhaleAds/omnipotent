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
 * @property customerClientLink - A link of our manager account to a client account
 * @property customer - The account queried
 */
export type GoogleAdsRow = {
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
  };
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
