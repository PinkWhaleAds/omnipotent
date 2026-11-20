import { generateKeyPairSync } from 'node:crypto';

import {
  createGoogleAdsAdapter,
  formatCustomerId,
  GoogleAdsAdapter,
  normalizeCustomerId,
} from '@src/platforms/google/google.adapter';
import { GoogleAdsClient } from '@src/platforms/google/google.client';
import { GOOGLE_ADS_API, GoogleAdsRow } from '@src/platforms/google/google.types';
import { LinkStatus, PlatformError } from '@src/platforms/platform-adapter';

/** A real key, so that the token exchange signs for real. */
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

/** The JSON key of our service account, as the secret store holds it. */
const KEY_JSON: string = JSON.stringify({
  type: 'service_account',
  client_email: 'ads@project.iam.gserviceaccount.com',
  private_key: privateKey,
});

/** The consent of our inviter, as pnpm google:connect writes it. */
const INVITER_JSON: string = JSON.stringify({ clientId: 'c-1', clientSecret: 's-1', refreshToken: 'r-1' });

/** Our manager account, and a client account under it. */
const MCC = '7719345054';
const CLIENT = '9725630707';

/**
 * A link of our MCC.
 *
 * @param clientId - The client account
 * @param status - Google's status of the link
 * @param managerLinkId - Its id, in the order links were made
 * @returns The row
 */
function link(clientId: string, status: string, managerLinkId?: string): GoogleAdsRow {
  return { customerClientLink: { clientCustomer: `customers/${clientId}`, status, managerLinkId } };
}

/**
 * The body of a refusal of Google Ads, listing its errors.
 *
 * @param codes - The codes of the errors, in order
 * @returns The body
 */
function refusal(...codes: string[]): object {
  return {
    error: {
      code: 400,
      status: 'INVALID_ARGUMENT',
      details: [
        {
          '@type': 'type.googleapis.com/google.ads.googleads.v25.errors.GoogleAdsFailure',
          errors: codes.map((code: string): object => ({ errorCode: { managerLinkError: code }, message: code })),
        },
      ],
    },
  };
}

/**
 * A JSON response.
 *
 * @param body - Its body
 * @param status - Its status
 * @returns The response
 */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('Unit::Platforms::Google::Adapter', () => {
  let links: GoogleAdsRow[];
  let customers: GoogleAdsRow[];
  let inviterSecret: string;
  let mutate: () => Response;
  let fetchFn: jest.Mock;
  let journal: { record: jest.Mock };
  let adapter: GoogleAdsAdapter;

  /**
   * The GAQL queries Google was sent, with the account each was run on.
   *
   * @returns One `[path, query]` per search
   */
  function searches(): [string, string][] {
    return fetchFn.mock.calls
      .filter(([url]: [string]): boolean => url.endsWith('googleAds:search'))
      .map(([url, init]: [string, RequestInit]): [string, string] => [
        url.slice(GOOGLE_ADS_API.baseUrl.length),
        (JSON.parse(init.body as string) as { query: string }).query,
      ]);
  }

  /**
   * The failure a call ends on.
   *
   * @param call - The call
   * @returns The error it threw
   */
  async function failureOf(call: Promise<unknown>): Promise<PlatformError> {
    return call.then(
      (): never => {
        throw new Error('expected a failure');
      },
      (thrown: PlatformError): PlatformError => thrown
    );
  }

  /**
   * The changes of links Google was sent, with the token each went with.
   *
   * @returns One `[authorization, body]` per change
   */
  function linkChanges(): [string, unknown][] {
    return fetchFn.mock.calls
      .filter(([url]: [string]): boolean => url.endsWith('customerClientLinks:mutate'))
      .map(([, init]: [string, RequestInit]): [string, unknown] => [
        (init.headers as Record<string, string>).Authorization,
        JSON.parse(init.body as string) as unknown,
      ]);
  }

  beforeEach((): void => {
    links = [];
    customers = [];
    inviterSecret = INVITER_JSON;
    mutate = (): Response => json({ result: {} });
    journal = { record: jest.fn() };
    fetchFn = jest.fn(async (url: string, init: RequestInit): Promise<Response> => {
      if (url === GOOGLE_ADS_API.tokenUrl) {
        // The inviter exchanges its refresh token; the service account, a signed assertion.
        const grant: string | null = new URLSearchParams(init.body as string).get('grant_type');
        return json({ access_token: grant === 'refresh_token' ? 'ya29.inviter' : 'ya29.token', expires_in: 3_600 });
      }
      if (url.endsWith('customerClientLinks:mutate')) return mutate();
      const { query } = JSON.parse(init.body as string) as { query: string };
      return json({ results: query.includes('FROM customer_client_link') ? links : customers });
    });
    adapter = createGoogleAdsAdapter(
      {
        managerId: '771-934-5054',
        loadServiceAccountKey: (): Promise<string> => Promise.resolve(KEY_JSON),
        loadInviterSecret: (): Promise<string> => Promise.resolve(inviterSecret),
        fetchFn,
      },
      journal
    );
  });

  describe('the customer ids', () => {
    it('should read a customer id with or without its dashes, and nothing else', (): void => {
      expect(normalizeCustomerId('972-563-0707')).toBe(CLIENT);
      expect(normalizeCustomerId(' 9725630707 ')).toBe(CLIENT);
      expect(normalizeCustomerId('972-563')).toBeNull();
      expect(normalizeCustomerId('97256307AB')).toBeNull();
    });

    it('should write one as Google Ads shows it', (): void => {
      expect(formatCustomerId(CLIENT)).toBe('972-563-0707');
    });
  });

  describe('createGoogleAdsAdapter', () => {
    it('should refuse a manager account that is not a customer id', (): void => {
      expect(() =>
        createGoogleAdsAdapter(
          { managerId: 'mcc', loadServiceAccountKey: jest.fn(), loadInviterSecret: jest.fn() },
          journal
        )
      ).toThrow('The Google Ads manager account mcc is not a customer id');
    });

    it('should be a platform whose accounts link to our manager account', (): void => {
      expect(adapter.platform).toBe('google_ads');
      expect(adapter.connection).toBe('manager_link');
      expect(adapter.referenceOf('972-563-0707')).toBe(CLIENT);
    });
  });

  describe('requestLink', () => {
    it('should send nothing for an account our MCC already manages, through our MCC and our token', async (): Promise<void> => {
      // A row Google answers without a link, before the link that matters.
      links = [{}, link(CLIENT, 'ACTIVE', '1')];

      await expect(adapter.requestLink(CLIENT)).resolves.toBe('active');

      const [path, query] = searches()[0];
      expect(path).toBe(`/customers/${MCC}/googleAds:search`);
      expect(query).toContain(`WHERE customer_client_link.client_customer = 'customers/${CLIENT}'`);
      const [, init] = fetchFn.mock.calls.find(([url]: [string]): boolean =>
        url.startsWith(GOOGLE_ADS_API.baseUrl)
      ) as [string, RequestInit];
      expect(init.headers).toMatchObject({ Authorization: 'Bearer ya29.token', 'login-customer-id': MCC });
      expect(journal.record).toHaveBeenCalledWith(expect.objectContaining({ platform: 'google_ads', statusCode: 200 }));
    });

    it('should send nothing for an account already invited', async (): Promise<void> => {
      links = [link(CLIENT, 'PENDING', '1')];

      await expect(adapter.requestLink(CLIENT)).resolves.toBe('pending');
    });

    it.each([
      ['no link at all', []],
      ['only a row without a link', [{}]],
      [
        'only an invitation it withdrew, the latest of its links',
        [link(CLIENT, 'ACTIVE', '1'), link(CLIENT, 'CANCELED', '2')],
      ],
    ])(
      'should invite, as our inviter, an account with %s',
      async (_label: string, rows: GoogleAdsRow[]): Promise<void> => {
        links = rows;

        await expect(adapter.requestLink(CLIENT)).resolves.toBe('pending');

        expect(linkChanges()).toEqual([
          [
            'Bearer ya29.inviter',
            { operation: { create: { clientCustomer: `customers/${CLIENT}`, status: 'PENDING' } } },
          ],
        ]);
      }
    );

    it.each([
      ['manages it already, read too late', 'ALREADY_MANAGED_BY_THIS_MANAGER', 'active'],
      ['invited it already', 'ALREADY_INVITED_BY_THIS_MANAGER', 'pending'],
      ['invited it already, in other words', 'CLIENT_ALREADY_INVITED_BY_THIS_MANAGER', 'pending'],
    ])(
      'should take as an answer that our MCC %s',
      async (_label: string, code: string, answer: string): Promise<void> => {
        mutate = (): Response => json(refusal('INVALID_CHANGE', code), 400);

        await expect(adapter.requestLink(CLIENT)).resolves.toBe(answer);
      }
    );

    it('should keep the code that says why Google refused, not the vaguer one before it', async (): Promise<void> => {
      mutate = (): Response => json(refusal('INVALID_CHANGE', 'TOO_MANY_MANAGERS'), 400);

      await expect(failureOf(adapter.requestLink(CLIENT))).resolves.toMatchObject({
        message: expect.stringContaining('TOO_MANY_MANAGERS'),
        options: { code: 'TOO_MANY_MANAGERS', retryable: false, ownCredentials: false },
      });
    });

    it('should let a refusal that says nothing more through as Google gave it', async (): Promise<void> => {
      mutate = (): Response => json(refusal('CUSTOMER_NOT_FOUND'), 400);

      await expect(failureOf(adapter.requestLink(CLIENT))).resolves.toMatchObject({
        options: { code: 'CUSTOMER_NOT_FOUND' },
      });
    });

    it('should ask the inviter a new token when Google refuses the one kept, and try once more', async (): Promise<void> => {
      let refusals = 1;
      mutate = (): Response =>
        refusals-- > 0 ? json({ error: { status: 'UNAUTHENTICATED', message: 'Expired' } }, 401) : json({ result: {} });

      await expect(adapter.requestLink(CLIENT)).resolves.toBe('pending');

      const inviterExchanges = fetchFn.mock.calls.filter(
        ([url, init]: [string, RequestInit]): boolean =>
          url === GOOGLE_ADS_API.tokenUrl &&
          new URLSearchParams(init.body as string).get('grant_type') === 'refresh_token'
      );
      expect(inviterExchanges).toHaveLength(2);
      expect(linkChanges()).toHaveLength(2);
    });

    it('should blame our own credentials when the inviter never consented', async (): Promise<void> => {
      inviterSecret = JSON.stringify({ clientId: 'c-1', clientSecret: 's-1' });

      const error: PlatformError = await failureOf(adapter.requestLink(CLIENT));

      expect(error.message).toContain('run pnpm google:connect');
      expect(error.options).toMatchObject({ ownCredentials: true, code: 'inviter_secret' });
      expect(linkChanges()).toEqual([]);
    });

    it('should let through, as it is, a refusal that carries no code at all', async (): Promise<void> => {
      const bare = new PlatformError('google_ads', 'Refused', {
        statusCode: 400,
        retryable: false,
        invalidCredentials: false,
        requestId: null,
      });
      const client = {
        managerId: MCC,
        search: jest.fn().mockResolvedValue([]),
        createClientLink: jest.fn().mockRejectedValue(bare),
      };

      await expect(new GoogleAdsAdapter(client as unknown as GoogleAdsClient).requestLink(CLIENT)).rejects.toBe(bare);
    });

    it('should let through a failure that is not the platform', async (): Promise<void> => {
      const broken = new Error('bug');
      const client = {
        managerId: MCC,
        search: jest.fn().mockResolvedValue([]),
        createClientLink: jest.fn().mockRejectedValue(broken),
      };

      await expect(new GoogleAdsAdapter(client as unknown as GoogleAdsClient).requestLink(CLIENT)).rejects.toBe(broken);
    });
  });

  describe('linkStatuses', () => {
    it('should read every link of our MCC at once, the latest of each account winning', async (): Promise<void> => {
      links = [
        // The latest first, then an older one that must not win.
        link('1111111111', 'ACTIVE', '9'),
        link('1111111111', 'PENDING', '5'),
        link('2222222222', 'REFUSED', '2'),
        link('3333333333', 'CANCELED', '3'),
        link('4444444444', 'INACTIVE'),
        // A link Google numbered after one it did not number: the numbered one wins.
        link('6666666666', 'INACTIVE'),
        link('6666666666', 'ACTIVE', '3'),
        // A link without a status says nothing.
        { customerClientLink: { clientCustomer: 'customers/7777777777' } },
        link('5555555555', 'SOMETHING_NEW', '1'),
        { customerClientLink: { clientCustomer: 'not-a-customer', status: 'ACTIVE' } },
        { customerClientLink: { status: 'ACTIVE' } },
      ];

      const statuses: Map<string, LinkStatus> = await adapter.linkStatuses();

      expect(Object.fromEntries(statuses)).toEqual({
        '1111111111': 'active',
        '2222222222': 'refused',
        '3333333333': 'refused',
        '4444444444': 'ended',
        '6666666666': 'active',
      });
      expect(searches()).toHaveLength(1);
      expect(searches()[0][1]).not.toContain('WHERE');
    });
  });

  describe('cancelLink', () => {
    it('should do nothing when no invitation is pending', async (): Promise<void> => {
      links = [link(CLIENT, 'ACTIVE', '1')];

      await expect(adapter.cancelLink(CLIENT)).resolves.toBeUndefined();
    });

    it.each([
      [
        'the resource name Google gave',
        {
          customerClientLink: {
            ...link(CLIENT, 'PENDING', '7').customerClientLink,
            resourceName: 'customers/x/customerClientLinks/y~7',
          },
        },
        'customers/x/customerClientLinks/y~7',
      ],
      [
        'a resource name rebuilt from its parts',
        link(CLIENT, 'PENDING', '7'),
        `customers/${MCC}/customerClientLinks/${CLIENT}~7`,
      ],
    ])(
      'should withdraw a pending invitation as our inviter, by %s',
      async (_label: string, row: GoogleAdsRow, resourceName: string): Promise<void> => {
        links = [row];

        await adapter.cancelLink(CLIENT);

        expect(linkChanges()).toEqual([
          [
            'Bearer ya29.inviter',
            { operation: { update: { resourceName, status: 'CANCELED' }, updateMask: 'status' } },
          ],
        ]);
      }
    );
  });

  describe('readLinkedAccount', () => {
    it('should read the name, the currency and the timezone on the account itself', async (): Promise<void> => {
      customers = [
        {
          customer: {
            id: CLIENT,
            descriptiveName: ' Client immobilier ',
            currencyCode: 'eur',
            timeZone: 'Europe/Paris',
          },
        },
      ];

      await expect(adapter.readLinkedAccount(CLIENT)).resolves.toEqual({
        externalId: CLIENT,
        name: 'Client immobilier',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        manager: false,
      });
      expect(searches()[0][0]).toBe(`/customers/${CLIENT}/googleAds:search`);
    });

    it('should name an account that has no name, and say when it is a manager account', async (): Promise<void> => {
      customers = [
        { customer: { descriptiveName: '  ', currencyCode: 'USD', timeZone: 'America/New_York', manager: true } },
      ];

      await expect(adapter.readLinkedAccount(CLIENT)).resolves.toMatchObject({
        name: 'Google Ads 972-563-0707',
        manager: true,
      });
    });

    it.each([
      ['no row at all', []],
      ['no currency', [{ customer: { timeZone: 'Europe/Paris' } }]],
      ['no timezone', [{ customer: { currencyCode: 'EUR' } }]],
    ])(
      'should refuse an account Google describes with %s',
      async (_label: string, rows: GoogleAdsRow[]): Promise<void> => {
        customers = rows;

        await expect(failureOf(adapter.readLinkedAccount(CLIENT))).resolves.toMatchObject({
          options: { code: 'customer_unreadable', retryable: false },
        });
      }
    );
  });

  describe('apply', () => {
    it('should refuse to push a campaign before lot 3 writes it', async (): Promise<void> => {
      await expect(adapter.apply({} as never, {} as never, {})).rejects.toMatchObject({
        statusCode: 500,
        errorCode: 'sync_adapter_missing',
        errorParams: { platform: 'google_ads' },
      });
    });
  });

  describe('the token', () => {
    it('should ask a new token when Google refuses the one kept, and try once more', async (): Promise<void> => {
      let refusals = 1;
      fetchFn.mockImplementation(async (url: string): Promise<Response> => {
        if (url === GOOGLE_ADS_API.tokenUrl) return json({ access_token: 'ya29.token', expires_in: 3_600 });
        if (refusals-- > 0) return json({ error: { status: 'UNAUTHENTICATED', message: 'Expired' } }, 401);
        return json({ results: [link(CLIENT, 'ACTIVE', '1')] });
      });

      await expect(adapter.requestLink(CLIENT)).resolves.toBe('active');
      expect(fetchFn.mock.calls.filter(([url]: [string]): boolean => url === GOOGLE_ADS_API.tokenUrl)).toHaveLength(2);
    });
  });
});
