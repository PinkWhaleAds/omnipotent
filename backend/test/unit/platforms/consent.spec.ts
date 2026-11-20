import { createHash } from 'node:crypto';

import { awaitConsent, ConsentOptions, pkcePair, reasonOf } from '@src/platforms/consent';
import { consentListening, FakeConsentServer, Page } from '@test/unit/mocks/consent-server.mock';

describe('Unit::Platforms::Consent', () => {
  let server: FakeConsentServer;
  let printed: string[];
  let exchange: jest.Mock;

  /**
   * The options of a consent, with the fakes of the spec.
   *
   * @param overrides - What to change
   * @returns The options
   */
  function options(overrides: Partial<ConsentOptions<string>> = {}): ConsentOptions<string> {
    return {
      platform: 'Acme',
      command: 'pnpm acme:connect',
      host: '127.0.0.1',
      port: 4100,
      path: '/acme/callback',
      state: 'st-1',
      instructions: 'Acme: open this page:',
      ready: (port: number): string => `https://consent.test/?port=${port}`,
      exchange,
      done: 'Saved.',
      print: (line: string): void => void printed.push(line),
      createServer: server.factory(),
      ...overrides,
    };
  }

  beforeEach((): void => {
    server = new FakeConsentServer();
    printed = [];
    exchange = jest.fn().mockResolvedValue('kept');
  });

  describe('pkcePair', () => {
    it('should derive the challenge from the verifier, as RFC 7636 says', (): void => {
      const { verifier, challenge } = pkcePair((size: number): Buffer => Buffer.alloc(size, 2));

      expect(verifier).toBe(Buffer.alloc(32, 2).toString('base64url'));
      expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    });
  });

  describe('reasonOf', () => {
    it('should give the message of an error, and the text of anything else', (): void => {
      expect(reasonOf(new Error('boom'))).toBe('boom');
      expect(reasonOf('denied')).toBe('denied');
    });
  });

  describe('awaitConsent', () => {
    it('should print the page once it listens, and keep what the code gives', async (): Promise<void> => {
      const run: Promise<string> = awaitConsent(options());
      await consentListening(server, printed);

      expect(server.listened).toEqual({ port: 4100, host: '127.0.0.1' });
      expect(printed).toEqual(['Acme: open this page:', 'https://consent.test/?port=5555']);
      const page: Page = await server.hit('/acme/callback?state=st-1&code=the-code');

      await expect(run).resolves.toBe('kept');
      expect(exchange).toHaveBeenCalledWith('the-code');
      expect(page).toEqual({ status: 200, text: 'Saved.\n' });
      expect(server.closed).toBe(true);
    });

    it.each([
      [
        'a refusal that explains itself',
        '?state=st-1&error=access_denied&error_description=User%20cancelled',
        'User cancelled',
      ],
      ['a refusal without explanation', '?state=st-1&error=access_denied', 'access_denied'],
      ['an answer without a code', '?state=st-1', 'no code'],
    ])('should tell %s on the page', async (_label: string, query: string, reason: string): Promise<void> => {
      const run: Promise<string> = awaitConsent(options());
      await consentListening(server, printed);
      const failed: Promise<void> = expect(run).rejects.toThrow(`Acme did not give the consent: ${reason}`);

      const page: Page = await server.hit(`/acme/callback${query}`);

      await failed;
      expect(page).toEqual({ status: 400, text: `Acme did not give the consent: ${reason}\n` });
      expect(exchange).not.toHaveBeenCalled();
    });

    it('should refuse an answer that carries another state, and name the command to run again', async (): Promise<void> => {
      const run: Promise<string> = awaitConsent(options());
      await consentListening(server, printed);
      const failed: Promise<void> = expect(run).rejects.toThrow('does not carry the state');

      const page: Page = await server.hit('/acme/callback?state=other&code=c');

      await failed;
      expect(page).toEqual({ status: 400, text: 'Unexpected answer: run pnpm acme:connect again.\n' });
    });

    it('should answer 404 off its path and 410 once the consent is over', async (): Promise<void> => {
      const run: Promise<string> = awaitConsent(options());
      await consentListening(server, printed);

      await expect(server.hit('/favicon.ico')).resolves.toMatchObject({ status: 404 });
      await server.hit('/acme/callback?state=st-1&code=c');
      await run;

      await expect(server.hit('/acme/callback?state=st-1&code=c')).resolves.toEqual({
        status: 410,
        text: 'This consent is already over: run pnpm acme:connect again.\n',
      });
    });

    it.each([
      ['an error', new Error('the store refused it')],
      ['anything else', 'the store refused it'],
    ])('should tell on the page an exchange that throws %s', async (_label: string, thrown: unknown): Promise<void> => {
      exchange.mockRejectedValue(thrown);
      const run: Promise<string> = awaitConsent(options());
      await consentListening(server, printed);
      const failed: Promise<void> = expect(run).rejects.toThrow('the store refused it');

      const page: Page = await server.hit('/acme/callback?state=st-1&code=c');

      await failed;
      expect(page).toEqual({ status: 502, text: 'The consent could not be saved: the store refused it\n' });
    });

    it('should stop when the server fails, and close it', async (): Promise<void> => {
      const run: Promise<string> = awaitConsent(options());
      await consentListening(server, printed);

      (server.onError as (error: Error) => void)(new Error('EADDRINUSE'));

      await expect(run).rejects.toThrow('EADDRINUSE');
      expect(server.closed).toBe(true);
    });

    it('should stop when no consent comes back in time', async (): Promise<void> => {
      await expect(awaitConsent(options({ timeoutMs: 5 }))).rejects.toThrow(
        'No consent came back in time: run pnpm acme:connect again'
      );
      expect(server.closed).toBe(true);
    });

    it.each([
      ['no address', null],
      ['a pipe for an address', '/tmp/pipe'],
    ])('should stop when the server has %s', async (_label: string, port: string | null): Promise<void> => {
      server = new FakeConsentServer(port);

      await expect(awaitConsent(options())).rejects.toThrow('The consent server has no port');
      expect(printed).toEqual([]);
    });
  });
});
