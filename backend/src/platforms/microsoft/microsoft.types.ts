/**
 * @module platforms/microsoft/microsoft.types
 *
 * What Omnipotent reads and sends of Microsoft Advertising, transcribed from multi-search
 * (`~/OmniAd/multi-search/backend/src/platforms/microsoft/microsoft.types.ts`), which runs it against
 * the real API. Only the **production** environment: we have no sandbox (`docs/phase-11.md` § 3). Only
 * what the connection of an account needs lives here so far; the campaigns add their shapes in lot B.
 */

/**
 * The fixed facts of the API and of its identity platform.
 *
 * The API is the JSON flavour of `v13`, whose fields are PascalCase as the SOAP elements are.
 */
export const MICROSOFT_ADS_API = {
  /** The Customer Management service: users, accounts, client links. */
  customerUrl: 'https://clientcenter.api.bingads.microsoft.com/CustomerManagement/v13',
  /** The consent page of the Microsoft identity platform, for personal and work accounts alike. */
  authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  /** Its token endpoint. */
  tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  /** The scope of the API, and an offline access: a refresh token. */
  scope: 'https://ads.microsoft.com/msads.manage offline_access',
  /** Response header carrying the id of a call, for Microsoft's support. */
  requestIdHeader: 'TrackingId',
  /** Longest wait for one response. */
  timeoutMs: 60_000,
  /** Longest wait for the token endpoint. */
  tokenTimeoutMs: 15_000,
  /** An access token is renewed this long before it expires. */
  tokenExpirySkewMs: 5 * 60_000,
  /** A refresh is forced when the last one is older: a refresh token dies after 90 days unused. */
  maxRefreshAgeMs: 7 * 86_400_000,
  /** Key of the PostgreSQL advisory lock taken to refresh the tokens. */
  refreshLockKey: 'microsoft-ads-oauth',
} as const;

/**
 * The secret of our Entra application and of our Microsoft Advertising developer token
 * (`docs/runbook-acces.md` C2 and C3).
 *
 * @property clientId - The application's id
 * @property clientSecret - Its secret
 * @property developerToken - Our developer token
 */
export type MicrosoftAppSecret = { clientId: string; clientSecret: string; developerToken: string };

/**
 * The tokens of our service user, written by `pnpm microsoft:connect` and **at every renewal**:
 * Microsoft gives a new refresh token each time.
 *
 * @property refreshToken - The latest refresh token
 * @property accessToken - The latest access token
 * @property accessTokenExpiresAt - When it expires, ISO 8601
 * @property refreshedAt - When the tokens were last exchanged, ISO 8601
 * @property userEmail - The account that consented, when Microsoft named it
 */
export type MicrosoftOAuthSecret = {
  refreshToken: string;
  accessToken: string | null;
  accessTokenExpiresAt: string | null;
  refreshedAt: string;
  userEmail?: string | null;
};

/** An answer of the token endpoint. */
export type MicrosoftTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
};

/** A refusal of the token endpoint (`invalid_grant`…). */
export type MicrosoftTokenErrorBody = { error?: string; error_description?: string };

/**
 * One error of a fault, of a batch or of a partial answer.
 *
 * @property Code - Its number — Customer Management always gives one
 * @property ErrorCode - Its name
 * @property Message - What it says
 * @property Details - More of it
 * @property FieldPath - Where, in the request
 * @property BatchErrors - The errors nested under it
 */
export type MicrosoftErrorEntry = {
  Code?: number | string | null;
  ErrorCode?: string | null;
  Message?: string | null;
  Details?: string | null;
  FieldPath?: string | null;
  BatchErrors?: unknown;
};

/**
 * The body of a failed call, whatever its fault type, or of an answer carrying partial errors.
 *
 * @property TrackingId - Microsoft's id of the call
 * @property Errors - The errors of an `AdApiFaultDetail`
 * @property OperationErrors - The errors of an `ApiFault`, Customer Management's
 * @property BatchErrors - The errors of an `ApiFaultDetail`, item by item
 * @property PartialErrors - The items that failed in an answer that succeeded
 */
export type MicrosoftFaultBody = MicrosoftErrorEntry & {
  TrackingId?: string | null;
  Errors?: unknown;
  OperationErrors?: unknown;
  PartialErrors?: unknown;
};

/**
 * A link of our manager account to a client account (`AccountLink`, `ClientEntity*` the account) or to
 * a client customer (`CustomerLink`).
 */
export type MicrosoftClientLink = {
  Type?: string | null;
  ClientEntityId?: string | number | null;
  ClientEntityNumber?: string | null;
  ClientEntityName?: string | null;
  ClientEntityCustomerNumber?: string | null;
  ManagingCustomerId?: string | number | null;
  IsBillToClient?: boolean;
  Name?: string | null;
  Status?: string | null;
  SuppressNotification?: boolean;
  Timestamp?: string | null;
};

/** An advertising account. */
export type MicrosoftAccount = {
  Id?: string | number;
  Number?: string;
  Name?: string;
  CurrencyCode?: string;
  TimeZone?: string;
  AccountLifeCycleStatus?: string;
  AccountMode?: string | null;
  ParentCustomerId?: string | number | null;
};
