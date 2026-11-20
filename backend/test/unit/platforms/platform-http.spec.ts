import { PlatformError } from '@src/platforms/platform-adapter';
import {
  PlatformErrorDescription,
  PlatformFailure,
  PlatformHttp,
  PlatformHttpOptions,
} from '@src/platforms/platform-http';

/** What a platform's reading of its errors answers when nothing in particular is said. */
const DESCRIBED: PlatformErrorDescription = {
  message: 'Refused',
  code: 'REFUSED',
  requestId: 'r-body',
  retryable: false,
  invalidCredentials: false,
};

describe('Unit::Platforms::PlatformHttp', () => {
  let fetchFn: jest.Mock;
  let journal: { record: jest.Mock };
  let describeError: jest.Mock;

  /**
   * The client, with a fake network.
   *
   * @param overrides - Settings to change
   * @returns The client
   */
  function client(overrides: Partial<PlatformHttpOptions> = {}): PlatformHttp {
    return new PlatformHttp({
      platform: 'google_ads',
      baseUrl: 'https://api.test/v1',
      timeoutMs: 1_000,
      requestIdHeader: 'request-id',
      journal,
      authorization: (): Promise<string> => Promise.resolve('Bearer t-1'),
      describeError,
      fetchFn: fetchFn as unknown as typeof fetch,
      ...overrides,
    });
  }

  beforeEach((): void => {
    jest.clearAllMocks();
    fetchFn = jest.fn();
    journal = { record: jest.fn() };
    describeError = jest.fn((): PlatformErrorDescription => DESCRIBED);
  });

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  it('should send a JSON body with our authentication, and answer the parsed body', async (): Promise<void> => {
    fetchFn.mockResolvedValue(new Response('{"ok":true}', { status: 200, headers: { 'request-id': 'r-1' } }));

    const answer: unknown = await client().request('acc-1', {
      method: 'POST',
      path: '/customers/1/googleAds:search?alt=json',
      body: { query: 'SELECT 1' },
      headers: { 'login-customer-id': '7719345054' },
      operations: 3,
    });

    expect(answer).toEqual({ ok: true });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/customers/1/googleAds:search?alt=json');
    expect(init).toMatchObject({
      method: 'POST',
      body: '{"query":"SELECT 1"}',
      headers: { Authorization: 'Bearer t-1', 'Content-Type': 'application/json', 'login-customer-id': '7719345054' },
    });
    // The path, never the payload, and never its query string.
    expect(journal.record).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'google_ads',
        adAccountId: 'acc-1',
        method: 'POST',
        path: '/customers/1/googleAds:search',
        statusCode: 200,
        requestId: 'r-1',
        error: null,
        operations: 3,
      })
    );
  });

  it('should send no body and count one operation when the request says nothing', async (): Promise<void> => {
    fetchFn.mockResolvedValue(new Response('', { status: 200 }));

    await expect(client().request(null, { method: 'GET', path: '/ping' })).resolves.toBeNull();

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeUndefined();
    expect(init.headers).toEqual({ Authorization: 'Bearer t-1' });
    expect(journal.record).toHaveBeenCalledWith(expect.objectContaining({ operations: 1, requestId: null }));
  });

  it('should answer a body that is not JSON as its text', async (): Promise<void> => {
    fetchFn.mockResolvedValue(new Response('plain words', { status: 200 }));

    await expect(client().request(null, { method: 'GET', path: '/text' })).resolves.toBe('plain words');
  });

  it("should turn an error status into the platform's own reading of it", async (): Promise<void> => {
    fetchFn.mockResolvedValue(
      new Response('{"error":{"message":"no"}}', { status: 403, headers: { 'request-id': 'r-2' } })
    );
    describeError.mockReturnValue({ ...DESCRIBED, codes: ['A', 'B'], ownCredentials: true, invalidCredentials: true });

    const error: PlatformError = (await client()
      .request('acc-1', { method: 'GET', path: '/x' })
      .catch((thrown: unknown): unknown => thrown)) as PlatformError;

    expect(describeError).toHaveBeenCalledWith({
      statusCode: 403,
      data: { error: { message: 'no' } },
      requestId: 'r-2',
      error: null,
    } satisfies PlatformFailure);
    expect(error).toBeInstanceOf(PlatformError);
    expect(error.message).toBe('Refused');
    expect(error.options).toMatchObject({
      statusCode: 403,
      retryable: false,
      invalidCredentials: true,
      ownCredentials: true,
      requestId: 'r-body',
      code: 'REFUSED',
      codes: ['A', 'B'],
    });
    expect(journal.record).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403, error: 'Refused' }));
  });

  it('should let the platform read a successful answer, and pass it when it finds nothing', async (): Promise<void> => {
    fetchFn.mockResolvedValue(
      new Response('{"PartialErrors":[null]}', { status: 200, headers: { 'request-id': 'r-3' } })
    );
    const checkResponse: jest.Mock = jest.fn().mockReturnValue(null);

    await expect(client({ checkResponse }).request(null, { method: 'POST', path: '/links' })).resolves.toEqual({
      PartialErrors: [null],
    });
    expect(checkResponse).toHaveBeenCalledWith({ statusCode: 200, data: { PartialErrors: [null] }, requestId: 'r-3' });
    expect(journal.record).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 200, error: null }));
  });

  it('should fail a successful answer that carries failures, as the platform reads them', async (): Promise<void> => {
    fetchFn.mockResolvedValue(new Response('{"PartialErrors":[{"Code":1410}]}', { status: 200 }));
    const checkResponse: jest.Mock = jest
      .fn()
      .mockReturnValue({ ...DESCRIBED, message: 'Already linked', code: '1410' });

    const error: PlatformError = (await client({ checkResponse })
      .request('acc-1', { method: 'POST', path: '/links' })
      .catch((thrown: unknown): unknown => thrown)) as PlatformError;

    expect(error).toBeInstanceOf(PlatformError);
    expect(error.message).toBe('Already linked');
    expect(error.options).toMatchObject({ statusCode: 200, code: '1410', requestId: 'r-body', ownCredentials: false });
    expect(describeError).not.toHaveBeenCalled();
    expect(journal.record).toHaveBeenCalledTimes(1);
    expect(journal.record).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 200, error: 'Already linked' }));
  });

  it('should say no response came back when the network failed', async (): Promise<void> => {
    const broken = new TypeError('fetch failed');
    fetchFn.mockRejectedValue(broken);

    const error: PlatformError = (await client()
      .request(null, { method: 'GET', path: '/x' })
      .catch((thrown: unknown): unknown => thrown)) as PlatformError;

    expect(describeError).toHaveBeenCalledWith({ statusCode: null, data: null, requestId: null, error: broken });
    // Neither ours nor the account's, unless the platform says so.
    expect(error.options).toMatchObject({ statusCode: null, ownCredentials: false, codes: [] });
    expect(journal.record).toHaveBeenCalledWith(expect.objectContaining({ statusCode: null }));
  });

  it('should send nothing, and journal nothing, when our authentication cannot be had', async (): Promise<void> => {
    const refused = new Error('no token');

    await expect(
      client({ authorization: (): Promise<string> => Promise.reject(refused) }).request(null, {
        method: 'GET',
        path: '/x',
      })
    ).rejects.toBe(refused);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(journal.record).not.toHaveBeenCalled();
  });

  it("should go through Node's own fetch when none is given", async (): Promise<void> => {
    const spy: jest.SpyInstance = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

    await client({ fetchFn: undefined }).request(null, { method: 'GET', path: '/x' });

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
