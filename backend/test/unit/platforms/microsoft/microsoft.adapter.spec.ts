import {
  createMicrosoftAdsAdapter,
  MicrosoftAdsAdapter,
  normalizeAccountNumber,
} from '@src/platforms/microsoft/microsoft.adapter';
import { MicrosoftAdsClient } from '@src/platforms/microsoft/microsoft.client';
import { MICROSOFT_ADS_API, MicrosoftAccount, MicrosoftClientLink } from '@src/platforms/microsoft/microsoft.types';
import { LinkStatus, PlatformError } from '@src/platforms/platform-adapter';

/** The clock of the specs, epoch milliseconds. */
const NOW = Date.UTC(2026, 10, 20, 10, 0, 0);

/** Our manager account's customer id. */
const CUSTOMER_ID = '255113635';

/** A client account, by its number, and its id. */
const ACCOUNT = 'F100AB12';
const ACCOUNT_ID = 900000001;

/** Our Entra application and developer token. */
const APP_JSON: string = JSON.stringify({ clientId: 'app-1', clientSecret: 'app-s', developerToken: 'dev-1' });

/** Tokens of our service user valid for an hour. */
const OAUTH_JSON: string = JSON.stringify({
  refreshToken: 'r-1',
  accessToken: 'a-1',
  accessTokenExpiresAt: new Date(NOW + 3_600_000).toISOString(),
  refreshedAt: new Date(NOW).toISOString(),
});

/** A call sent to Customer Management: its method, its path, its body and its headers. */
type Sent = [string, string, unknown, Record<string, string>];

/**
 * A link of our manager account to a client account.
 *
 * @param number - The account's number
 * @param status - Microsoft's status of the link
 * @param id - The account's id
 * @returns The link
 */
function link(number: string, status: string, id: number | null = ACCOUNT_ID): MicrosoftClientLink {
  return { Type: 'AccountLink', ClientEntityNumber: number, ClientEntityId: id, Status: status };
}

/**
 * An account that can be managed.
 *
 * @param overrides - What to change
 * @returns The account
 */
function account(overrides: Partial<MicrosoftAccount> = {}): MicrosoftAccount {
  return {
    Id: ACCOUNT_ID,
    Number: ACCOUNT,
    Name: ' Acme Store ',
    CurrencyCode: 'eur',
    TimeZone: 'BrusselsCopenhagenMadridParis',
    AccountLifeCycleStatus: 'Active',
    AccountMode: 'Expert',
    ...overrides,
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

describe('Unit::Platforms::Microsoft::Adapter', () => {
  let owned: MicrosoftAccount[];
  let links: MicrosoftClientLink[];
  let queried: MicrosoftAccount | null;
  let added: () => Response;
  let fetchFn: jest.Mock;
  let journal: { record: jest.Mock };
  let oauth: string;
  let adapter: MicrosoftAdsAdapter;

  /**
   * The calls sent to Customer Management, without the token endpoint's.
   *
   * @returns One `[method, path, body, headers]` per call
   */
  function calls(): Sent[] {
    return fetchFn.mock.calls
      .filter(([url]: [string]): boolean => url.startsWith(MICROSOFT_ADS_API.customerUrl))
      .map(([url, init]: [string, RequestInit]): Sent => [
        init.method as string,
        url.slice(MICROSOFT_ADS_API.customerUrl.length),
        JSON.parse(init.body as string) as unknown,
        init.headers as Record<string, string>,
      ]);
  }

  /**
   * The links sent or changed.
   *
   * @param method - `POST` to send, `PUT` to change
   * @returns The body of each
   */
  function linkWrites(method: string): unknown[] {
    return calls()
      .filter(([verb, path]: Sent): boolean => verb === method && path === '/ClientLinks')
      .map(([, , body]: Sent): unknown => body);
  }

  beforeEach((): void => {
    owned = [];
    links = [];
    queried = account();
    added = (): Response => json({ PartialErrors: [null] });
    oauth = OAUTH_JSON;
    journal = { record: jest.fn() };
    fetchFn = jest.fn(async (url: string, init: RequestInit): Promise<Response> => {
      if (url === MICROSOFT_ADS_API.tokenUrl) return json({ access_token: 'a-new', refresh_token: 'r-new' });
      const path: string = url.slice(MICROSOFT_ADS_API.customerUrl.length);
      if (path === '/Accounts/Search') return json({ Accounts: owned });
      if (path === '/ClientLinks/Search') return json({ ClientLinks: links });
      if (path === '/ClientLinks') return init.method === 'POST' ? added() : json({ PartialErrors: [] });
      return json({ Account: queried });
    });
    adapter = createMicrosoftAdsAdapter(
      {
        customerId: CUSTOMER_ID,
        credentials: {
          readApp: (): Promise<string> => Promise.resolve(APP_JSON),
          readOAuth: (): Promise<string> => Promise.resolve(oauth),
          writeOAuth: async (value: string): Promise<void> => {
            oauth = value;
          },
        },
        withLock: <T>(_key: string, work: () => Promise<T>): Promise<T> => work(),
        fetchFn: fetchFn as unknown as typeof fetch,
        now: (): number => NOW,
      },
      journal
    );
  });

  describe('the account numbers', () => {
    it('should read an account number as the client types it, and nothing else', (): void => {
      expect(normalizeAccountNumber(' f100ab12 ')).toBe(ACCOUNT);
      expect(normalizeAccountNumber('F100AB1')).toBeNull();
      expect(normalizeAccountNumber('F100-AB12')).toBeNull();
      expect(normalizeAccountNumber('K120003KD1')).toBeNull();
    });
  });

  describe('createMicrosoftAdsAdapter', () => {
    it('should be a platform whose accounts link to our manager account', (): void => {
      expect(adapter.platform).toBe('microsoft');
      expect(adapter.connection).toBe('manager_link');
      expect(adapter.referenceOf('f100ab12')).toBe(ACCOUNT);
    });

    it('should call as our service user, with our developer token, and journal each call', async (): Promise<void> => {
      await adapter.linkStatuses();

      const [[method, path, , headers]] = calls();
      expect([method, path]).toEqual(['POST', '/ClientLinks/Search']);
      expect(headers).toMatchObject({ Authorization: 'Bearer a-1', DeveloperToken: 'dev-1' });
      expect(journal.record).toHaveBeenCalledWith(
        expect.objectContaining({ platform: 'microsoft', path: '/ClientLinks/Search', statusCode: 200 })
      );
    });

    it('should renew a token Microsoft refuses, and send once more with the new one', async (): Promise<void> => {
      fetchFn.mockImplementationOnce(async (): Promise<Response> => json({ Errors: [{ Code: 109 }] }, 401));

      await adapter.linkStatuses();

      const sent: Sent[] = calls();
      expect(sent.map(([, , , headers]): string => headers.Authorization)).toEqual(['Bearer a-1', 'Bearer a-new']);
      expect(JSON.parse(oauth)).toMatchObject({ refreshToken: 'r-new', accessToken: 'a-new' });
    });
  });

  describe('requestLink', () => {
    it('should send nothing for an account our own customer owns', async (): Promise<void> => {
      owned = [account({ Number: 'f100ab12' })];

      await expect(adapter.requestLink(ACCOUNT, {})).resolves.toBe('active');

      const [[, path, body]] = calls();
      expect(path).toBe('/Accounts/Search');
      expect(body).toMatchObject({ Predicates: [{ Field: 'CustomerId', Operator: 'Equals', Value: CUSTOMER_ID }] });
      expect(calls()).toHaveLength(1);
    });

    it.each([
      ['manages', [link(ACCOUNT, 'LinkDeclined'), link(ACCOUNT, 'Active')], 'active'],
      ['already invited', [link(ACCOUNT, 'LinkDeclined'), link(ACCOUNT.toLowerCase(), 'LinkPending')], 'pending'],
    ])(
      'should send nothing for an account our manager account %s',
      async (_label: string, found: MicrosoftClientLink[], status: string): Promise<void> => {
        owned = [account({ Number: 'F200AB12' })];
        // A link to a whole customer, an agency's, is not a link to the account, even the latest.
        links = [...found, { ...link(ACCOUNT, 'LinkPending'), Type: 'CustomerLink' }];

        await expect(adapter.requestLink(ACCOUNT, { customerNumber: 'C100AB1234' })).resolves.toBe(status);
        expect(linkWrites('POST')).toEqual([]);
      }
    );

    it.each([
      ['no link', []],
      ['a refused link', [link(ACCOUNT, 'LinkDeclined')]],
      ['a link whose status Microsoft never documented', [link(ACCOUNT, 'Unheard')]],
      ['a link to another account', [link('F300AB12', 'Active')]],
    ])(
      'should invite an account with %s, billed to its client',
      async (_label: string, found: MicrosoftClientLink[]): Promise<void> => {
        links = found;

        await expect(adapter.requestLink(ACCOUNT, { customerNumber: ' c100ab1234 ' })).resolves.toBe('pending');

        expect(linkWrites('POST')).toEqual([
          {
            ClientLinks: [
              {
                Type: 'AccountLink',
                ClientEntityNumber: ACCOUNT,
                ClientEntityCustomerNumber: 'C100AB1234',
                ManagingCustomerId: CUSTOMER_ID,
                IsBillToClient: true,
                Name: 'Omnipotent',
                SuppressNotification: false,
              },
            ],
          },
        ]);
      }
    );

    it.each([
      ['no scope at all', {}],
      ['an empty customer number', { customerNumber: '  ' }],
    ])('should refuse to invite with %s', async (_label: string, scope: Record<string, string>): Promise<void> => {
      const error: PlatformError = await failureOf(adapter.requestLink(ACCOUNT, scope));

      expect(error.message).toBe(
        `Microsoft Advertising account ${ACCOUNT} cannot be invited without the customer number of the client that owns it`
      );
      expect(error.options).toMatchObject({
        retryable: false,
        messageCode: 'ad_account_customer_number_required',
        messageParams: { platform: 'microsoft' },
      });
      expect(linkWrites('POST')).toEqual([]);
    });

    it('should take an invitation Microsoft says is already sent for a pending one', async (): Promise<void> => {
      added = (): Response => json({ PartialErrors: [{ Code: 1410, Message: 'Already linked.' }] });

      await expect(adapter.requestLink(ACCOUNT, { customerNumber: 'C100AB1234' })).resolves.toBe('pending');
    });

    it('should say a prepaid account must switch to invoicing first', async (): Promise<void> => {
      added = (): Response => json({ OperationErrors: [{ Code: 1471, Message: 'Prepaid.' }] }, 400);

      const error: PlatformError = await failureOf(adapter.requestLink(ACCOUNT, { customerNumber: 'C100AB1234' }));

      expect(error.options).toMatchObject({ messageCode: 'ad_account_prepaid', retryable: false });
    });

    it("should let Microsoft's other refusals through", async (): Promise<void> => {
      added = (): Response => json({ OperationErrors: [{ Code: 2003, Message: 'No access.' }] }, 400);

      const error: PlatformError = await failureOf(adapter.requestLink(ACCOUNT, { customerNumber: 'C100AB1234' }));

      expect(error.options).toMatchObject({ code: '2003', invalidCredentials: true });
      expect(error.options.messageCode ?? null).toBeNull();
    });

    it('should let anything else through untouched', async (): Promise<void> => {
      const boom = new Error('boom');
      const client = {
        customerId: CUSTOMER_ID,
        accountsOf: jest.fn().mockResolvedValue([]),
        clientLinks: jest.fn().mockResolvedValue([]),
        addClientLinks: jest.fn().mockRejectedValue(boom),
      };

      await expect(
        new MicrosoftAdsAdapter(client as unknown as MicrosoftAdsClient).requestLink(ACCOUNT, {
          customerNumber: 'C100AB1234',
        })
      ).rejects.toBe(boom);
    });
  });

  describe('linkStatuses', () => {
    it.each([
      ['LinkPending', 'pending'],
      ['LinkAccepted', 'pending'],
      ['LinkInProgress', 'pending'],
      ['Active', 'active'],
      ['UnlinkFailed', 'active'],
      ['LinkDeclined', 'refused'],
      ['LinkFailed', 'refused'],
      ['LinkCanceled', 'refused'],
      ['LinkExpired', 'expired'],
      ['UnlinkRequested', 'ended'],
      ['UnlinkPending', 'ended'],
      ['UnlinkInProgress', 'ended'],
      ['Inactive', 'ended'],
    ])('should read a link %s as %s', async (status: string, ours: string): Promise<void> => {
      links = [link(ACCOUNT.toLowerCase(), status)];

      await expect(adapter.linkStatuses()).resolves.toEqual(new Map([[ACCOUNT, ours]]));
    });

    it('should leave aside the links to whole customers and the statuses it does not know', async (): Promise<void> => {
      links = [
        link(ACCOUNT, 'Active'),
        { ...link('F200AB12', 'Active'), Type: 'CustomerLink' },
        link('F300AB12', 'Unheard'),
        { ...link('F400AB12', 'Active'), Status: null },
      ];

      await expect(adapter.linkStatuses()).resolves.toEqual(new Map<string, LinkStatus>([[ACCOUNT, 'active']]));
    });
  });

  describe('cancelLink', () => {
    it('should withdraw the pending invitation', async (): Promise<void> => {
      links = [link(ACCOUNT, 'LinkPending')];

      await adapter.cancelLink(ACCOUNT);

      expect(linkWrites('PUT')).toEqual([
        {
          ClientLinks: [
            {
              Type: 'AccountLink',
              ClientEntityId: ACCOUNT_ID,
              ClientEntityNumber: ACCOUNT,
              ManagingCustomerId: CUSTOMER_ID,
              Status: 'LinkCanceled',
            },
          ],
        },
      ]);
    });

    it.each([
      ['no link', []],
      ['an active link', [link(ACCOUNT, 'LinkPending'), link(ACCOUNT, 'Active')]],
    ])('should do nothing with %s', async (_label: string, found: MicrosoftClientLink[]): Promise<void> => {
      links = found;

      await adapter.cancelLink(ACCOUNT);

      expect(linkWrites('PUT')).toEqual([]);
    });
  });

  describe('readLinkedAccount', () => {
    it('should read an account our own customer owns, by its id', async (): Promise<void> => {
      owned = [account()];

      await expect(adapter.readLinkedAccount(ACCOUNT)).resolves.toEqual({
        externalId: String(ACCOUNT_ID),
        name: 'Acme Store',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        manager: false,
      });
      const query = calls().find(([, path]: Sent): boolean => path === '/Account/Query');
      expect(query?.[2]).toEqual({ AccountId: String(ACCOUNT_ID), ReturnAdditionalFields: 'AccountMode' });
    });

    it('should read an account our manager account manages, under its latest active link', async (): Promise<void> => {
      // Our customer names one without an id: not one to use.
      owned = [account({ Id: undefined })];
      links = [link(ACCOUNT, 'Active', 900000002), link(ACCOUNT, 'Inactive', 900000003), link(ACCOUNT, 'Active')];

      await expect(adapter.readLinkedAccount(ACCOUNT)).resolves.toMatchObject({ externalId: String(ACCOUNT_ID) });
    });

    it.each([
      ['no link', []],
      ['a pending link', [link(ACCOUNT, 'LinkPending')]],
      ['an active link without an id', [link(ACCOUNT, 'Active', null)]],
    ])('should refuse an account with %s', async (_label: string, found: MicrosoftClientLink[]): Promise<void> => {
      links = found;

      const error: PlatformError = await failureOf(adapter.readLinkedAccount(ACCOUNT));

      expect(error.message).toBe(`Microsoft Advertising account ${ACCOUNT} is not managed by our manager account`);
      expect(error.options).toMatchObject({ messageCode: 'ad_account_link_not_active' });
    });

    it('should refuse a Smart account', async (): Promise<void> => {
      owned = [account()];
      queried = account({ AccountMode: 'Smart' });

      const error: PlatformError = await failureOf(adapter.readLinkedAccount(ACCOUNT));

      expect(error.options).toMatchObject({
        messageCode: 'ad_account_not_expert',
        messageParams: { platform: 'microsoft', mode: 'Smart' },
      });
    });

    it.each(['Inactive', 'Suspended'])('should refuse an account that is %s', async (status: string): Promise<void> => {
      owned = [account()];
      queried = account({ AccountLifeCycleStatus: status });

      const error: PlatformError = await failureOf(adapter.readLinkedAccount(ACCOUNT));

      expect(error.message).toBe(`Microsoft Advertising account ${ACCOUNT} is ${status.toLowerCase()}`);
      expect(error.options).toMatchObject({ messageCode: 'ad_account_inactive', messageParams: { status } });
    });

    it.each([
      ['a time zone it does not know', { TimeZone: 'Mars' }, 'Mars'],
      ['no time zone', { TimeZone: undefined }, ''],
      ['no currency', { CurrencyCode: undefined }, 'BrusselsCopenhagenMadridParis'],
    ])(
      'should guess nothing for an account with %s',
      async (_label: string, overrides: Partial<MicrosoftAccount>, timezone: string): Promise<void> => {
        owned = [account()];
        queried = account(overrides);

        const error: PlatformError = await failureOf(adapter.readLinkedAccount(ACCOUNT));

        expect(error.options).toMatchObject({
          messageCode: 'ad_account_timezone_unknown',
          messageParams: { timezone },
        });
      }
    );

    it.each([
      ['no name', { Name: undefined }],
      ['a blank name', { Name: '  ' }],
    ])(
      'should name an account with %s after its number, and take an account without mode',
      async (_label: string, overrides: Partial<MicrosoftAccount>): Promise<void> => {
        owned = [account()];
        queried = account({ ...overrides, AccountMode: null });

        await expect(adapter.readLinkedAccount(ACCOUNT)).resolves.toMatchObject({
          name: `Microsoft Advertising ${ACCOUNT}`,
        });
      }
    );

    it('should read an empty account when Microsoft answers none, and refuse it', async (): Promise<void> => {
      owned = [account()];
      queried = null;

      await expect(adapter.readLinkedAccount(ACCOUNT)).rejects.toMatchObject({
        options: { messageCode: 'ad_account_timezone_unknown' },
      });
    });
  });

  describe('apply', () => {
    it('should refuse until the campaigns arrive', async (): Promise<void> => {
      await expect(adapter.apply({} as never, {} as never, {})).rejects.toMatchObject({
        statusCode: 500,
        errorCode: 'sync_adapter_missing',
        errorParams: { platform: 'microsoft' },
      });
    });
  });
});
