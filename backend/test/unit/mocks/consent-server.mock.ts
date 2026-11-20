import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { ConsentServer } from '@src/platforms/consent';

/** What the browser receives from the consent server. */
export type Page = { status: number; text: string };

/**
 * A consent server that listens nowhere: the specs hand it the browser's requests. Every consent
 * command shares it (`src/platforms/consent.ts`), so its fake lives here rather than in each spec.
 */
export class FakeConsentServer implements ConsentServer {
  /** What `node:http` would call on each request. */
  public listener: RequestListener | null = null;

  /** What the command does on a failure of the server. */
  public onError: ((error: Error) => void) | null = null;

  /** Where the command asked it to listen. */
  public listened: { port: number; host: string } | null = null;

  /** Whether the command closed it. */
  public closed = false;

  /**
   * @param port - What `address()` answers: a port, a pipe name, or nothing
   */
  constructor(private readonly port: number | string | null = 5555) {}

  /**
   * What a command passes as its `createServer`: keeps the listener, answers this server.
   *
   * @returns The factory
   */
  public factory(): (listener: RequestListener) => ConsentServer {
    return (listener: RequestListener): ConsentServer => {
      this.listener = listener;
      return this;
    };
  }

  /** @inheritdoc */
  public listen(port: number, host: string, ready: () => void): void {
    this.listened = { port, host };
    ready();
  }

  /** @inheritdoc */
  public on(_event: 'error', listener: (error: Error) => void): void {
    this.onError = listener;
  }

  /** @inheritdoc */
  public address(): AddressInfo | string | null {
    if (this.port === null || typeof this.port === 'string') return this.port;
    return { port: this.port, address: '127.0.0.1', family: 'IPv4' };
  }

  /** @inheritdoc */
  public close(): void {
    this.closed = true;
  }

  /**
   * Send a request of the browser.
   *
   * @param url - Its path and query, `undefined` for a request that carries none
   * @returns What the page will say, once written
   */
  public hit(url: string | undefined): Promise<Page> {
    return new Promise<Page>((resolve): void => {
      let status = 0;
      const response = {
        writeHead: (code: number): void => {
          status = code;
        },
        end: (text: string): void => resolve({ status, text }),
      };
      (this.listener as RequestListener)({ url } as IncomingMessage, response as unknown as ServerResponse);
    });
  }
}

/**
 * Wait until a command listens and printed its consent page: it reads the secret store first, so its
 * server starts later.
 *
 * @param server - The fake server
 * @param printed - What the command printed so far
 * @returns A promise that resolves once the consent page is printed
 */
export async function consentListening(server: FakeConsentServer, printed: string[]): Promise<void> {
  while (server.listener === null || printed.length < 2) {
    await new Promise<void>((resolve): void => void setImmediate(resolve));
  }
}
