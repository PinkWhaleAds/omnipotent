/**
 * @module platforms/consent
 *
 * What the consent commands share — `pnpm google:connect`, `pnpm microsoft:connect`: a PKCE pair, and
 * a small local server that waits for a platform's consent page to send the person back, checks that
 * the answer is the one it asked for, and hands its code over (`docs/phase-10.md` § 3,
 * `docs/phase-11.md` § 3). No secret nor token ever goes through here: only a code, exchanged at once
 * by the caller.
 */
import { createHash } from 'node:crypto';
import { createServer, IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** Longest wait for a consent, once its page is printed. */
export const CONSENT_TIMEOUT_MS = 10 * 60_000;

/** The HTTP server receiving a consent: a `node:http` server. */
export type ConsentServer = {
  listen(port: number, host: string, ready: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  address(): AddressInfo | string | null;
  close(): unknown;
};

/**
 * What a consent waits for.
 *
 * @property platform - Who gives the consent, for the messages: `Google`, `Microsoft`
 * @property command - The command to run again on a failure: `pnpm google:connect`
 * @property host - Where the server listens: the loopback
 * @property port - On which port; `0` lets the system choose
 * @property path - The path the consent comes back on
 * @property state - The random value sent with the consent page, checked on the way back
 * @property instructions - The line printed before the consent page: who must sign in
 * @property ready - Called once listening, with the port, and returns the consent page's URL to print
 * @property exchange - Turns the code into what the command keeps; its failure is told on the page
 * @property done - What the page says once it is kept
 * @property print - Writes a line for the person running the command
 * @property createServer - Builds the server; Node's own by default
 * @property timeoutMs - Longest wait
 */
export type ConsentOptions<T> = {
  platform: string;
  command: string;
  host: string;
  port: number;
  path: string;
  state: string;
  instructions: string;
  ready: (port: number) => string;
  exchange: (code: string) => Promise<T>;
  done: string;
  print: (line: string) => void;
  createServer?: (listener: RequestListener) => ConsentServer;
  timeoutMs?: number;
};

/**
 * A PKCE pair (RFC 7636): a random verifier, and its SHA-256 challenge.
 *
 * @param random - Random bytes
 * @returns The verifier kept, and the challenge sent with the consent page
 */
export function pkcePair(random: (size: number) => Buffer): { verifier: string; challenge: string } {
  const verifier: string = random(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/**
 * The reason a thrown value gives.
 *
 * @param error - The value
 * @returns Its message
 */
export function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Answer the browser with a short page.
 *
 * @param response - The response
 * @param status - HTTP status
 * @param text - The message
 */
function page(response: ServerResponse, status: number, text: string): void {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(`${text}\n`);
}

/**
 * Wait for a consent, and keep what its code gives.
 *
 * Starts the server, prints the consent page once it listens, and answers each request the browser
 * sends: `404` off the path, `410` once the consent is over, `400` for an answer carrying another
 * state or no code, and the exchange otherwise — once, its failure told on the page. The server is
 * closed however it ends, and nothing comes back past the timeout.
 *
 * @param options - Platform, address, state, exchange and messages
 * @returns What the exchange gave
 * @throws Error when the consent is refused, the state differs, the exchange fails, the server fails
 *   or nothing comes back in time
 */
export async function awaitConsent<T>(options: ConsentOptions<T>): Promise<T> {
  const { platform, command, print } = options;
  let server: ConsentServer | undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await new Promise<T>((resolve, reject): void => {
      let settled = false;
      const settle = (error: Error | null, value?: T): void => {
        settled = true;
        if (error) reject(error);
        else resolve(value as T);
      };
      const exchange = async (code: string, response: ServerResponse): Promise<void> => {
        try {
          const value: T = await options.exchange(code);
          page(response, 200, options.done);
          settle(null, value);
        } catch (error: unknown) {
          page(response, 502, `The consent could not be saved: ${reasonOf(error)}`);
          settle(error instanceof Error ? error : new Error(reasonOf(error)));
        }
      };
      const listener: RequestListener = (request: IncomingMessage, response: ServerResponse): void => {
        const received = new URL(request.url ?? '/', 'http://127.0.0.1');
        const code: string | null = received.searchParams.get('code');
        const refused: string | null = received.searchParams.get('error');
        if (received.pathname !== options.path) {
          page(response, 404, 'Not found');
        } else if (settled) {
          page(response, 410, `This consent is already over: run ${command} again.`);
        } else if (received.searchParams.get('state') !== options.state) {
          page(response, 400, `Unexpected answer: run ${command} again.`);
          settle(new Error('The answer does not carry the state sent with the consent page'));
        } else if (refused || !code) {
          const reason: string = received.searchParams.get('error_description') ?? refused ?? 'no code';
          page(response, 400, `${platform} did not give the consent: ${reason}`);
          settle(new Error(`${platform} did not give the consent: ${reason}`));
        } else {
          settled = true;
          void exchange(code, response);
        }
      };

      const started: ConsentServer = (options.createServer ?? createServer)(listener);
      server = started;
      started.on('error', (failure: Error): void => settle(failure));
      timer = setTimeout(
        (): void => settle(new Error(`No consent came back in time: run ${command} again`)),
        options.timeoutMs ?? CONSENT_TIMEOUT_MS
      );
      timer.unref();
      started.listen(options.port, options.host, (): void => {
        const address: AddressInfo | string | null = started.address();
        if (address === null || typeof address === 'string') {
          settle(new Error('The consent server has no port'));
          return;
        }
        print(options.instructions);
        print(options.ready(address.port));
      });
    });
  } finally {
    clearTimeout(timer);
    server?.close();
  }
}
