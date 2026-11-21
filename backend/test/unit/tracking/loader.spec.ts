import vm from 'node:vm';

import { embedJson, renderLoader } from '@src/tracking/loader';
import type { LoaderConfig, LoaderGoal } from '@src/tracking/loader-config';

/** A `<script>` element the page created. */
type FakeScript = { tagName: string; async?: boolean; src?: string };

/** What a call looks like once copied out of the page (dates become strings). */
type Call = unknown[];

/** The snippet the site pastes in its `<head>` (as documented to the user). */
const SNIPPET = `(function (w, d, s, u) {
  w.msq = w.msq || function () { (w.msq.q = w.msq.q || []).push(arguments); };
  var j = d.createElement(s); j.async = 1; j.src = u; d.head.appendChild(j);
})(window, document, 'script', 'https://t.example.net/t/k3yK3yK3yK3yK3yK.js');`;

const GTAG_URL = 'https://www.googletagmanager.com/gtag/js?id=AW-111';
const LOADER_URL = 'https://t.example.net/t/k3yK3yK3yK3yK3yK.js';

const PURCHASE: LoaderGoal = {
  category: 'purchase',
  valueMode: 'dynamic',
  defaultValue: 50,
  currency: 'EUR',
  google: [{ sendTo: 'AW-111/abc' }, { sendTo: 'AW-222/def' }],
};

const LEAD: LoaderGoal = {
  category: 'lead',
  valueMode: 'none',
  defaultValue: null,
  currency: null,
  google: [{ sendTo: 'AW-111/lead' }],
};

const QUOTE: LoaderGoal = {
  category: 'other',
  valueMode: 'fixed',
  defaultValue: 120,
  currency: 'USD',
  google: [{ sendTo: 'AW-111/quote' }],
};

const SUBSCRIPTION: LoaderGoal = {
  category: 'subscription',
  valueMode: 'dynamic',
  defaultValue: null,
  currency: null,
  google: [{ sendTo: 'AW-111/sub' }],
};

const CONFIG: LoaderConfig = {
  googleTagIds: ['AW-111', 'AW-222'],
  goals: { purchase: PURCHASE, lead: LEAD, quote: QUOTE, subscription: SUBSCRIPTION },
};

/**
 * Copy a value out of the page's realm as plain JSON (arguments objects become arrays).
 *
 * @param entry - Arguments or array recorded by the page
 * @returns The values, JSON-serialized and parsed back
 */
function plain(entry: ArrayLike<unknown>): Call {
  return JSON.parse(JSON.stringify(Array.from(entry)));
}

/** A browser page: a `node:vm` context with a fake `window` and `document`. */
class Page {
  readonly scripts: FakeScript[] = [];
  readonly warnings: string[] = [];
  readonly window: Record<string, any>;

  constructor(globals: Record<string, unknown> = {}) {
    const document: Record<string, unknown> = {
      createElement: (tagName: string): FakeScript => ({ tagName }),
      head: {
        appendChild: (script: FakeScript): void => {
          this.scripts.push(script);
        },
      },
    };
    this.window = { document, console: { warn: (message: string) => this.warnings.push(message) }, ...globals };
    this.window.window = this.window;
    vm.createContext(this.window);
  }

  /** Runs code in the page, like a `<script>`. */
  run(code: string): void {
    vm.runInContext(code, this.window);
  }

  /** Runs the snippet the site pastes. */
  paste(): void {
    this.run(SNIPPET);
  }

  /** Runs the tracking script. */
  load(config: LoaderConfig = CONFIG): void {
    this.run(renderLoader(config));
  }

  /** Calls `msq` like the site does. */
  msq(...args: unknown[]): void {
    this.window.msq(...args);
  }

  /** URLs of the scripts the page loaded, in order. */
  get sources(): string[] {
    return this.scripts.map((script: FakeScript): string => script.src as string);
  }

  /** Calls queued for Google (`dataLayer`). */
  get google(): Call[] {
    return (this.window.dataLayer ?? []).map(plain);
  }

  /** The conversions Google received. */
  get sent(): Call[] {
    return this.google.filter((call: Call) => call[0] === 'event');
  }
}

/**
 * A page where the snippet ran, then the tracking script.
 *
 * @param config - The configuration of the script
 * @param globals - What the page already has
 * @returns The page
 */
function loadedPage(config: LoaderConfig = CONFIG, globals: Record<string, unknown> = {}): Page {
  const page: Page = new Page(globals);
  page.paste();
  page.load(config);
  return page;
}

describe('Unit::Tracking::Loader', () => {
  describe('renderLoader', () => {
    it('should render a self-contained ES5 script', (): void => {
      const script: string = renderLoader(CONFIG);

      expect(script.startsWith('/* Omnipotent tracking script */\n(function (window, document, config) {')).toBe(true);
      expect(script).toContain(`})(window, document, ${embedJson(CONFIG)});`);
      expect(script).not.toMatch(/=>|`|\blet\b|\bconst\b|\bclass\b|\.\.\./);
      expect(script).not.toMatch(/\brequire\(|\bimport\b/);
    });

    it('should embed the config so it cannot break out of a script', (): void => {
      const evil = '</script><script>alert(1)</script>&\u2028\u2029';
      const script: string = renderLoader({ googleTagIds: [evil], goals: {} });

      expect(script).not.toContain('</script');
      expect(script).not.toMatch(/[\u2028\u2029]/);
      expect(script).toContain(
        '\\u003c/script\\u003e\\u003cscript\\u003ealert(1)\\u003c/script\\u003e\\u0026\\u2028\\u2029'
      );

      const page: Page = loadedPage({ googleTagIds: [evil], goals: {} });
      page.msq('consent', { ads: 'granted' });
      expect(page.google).toContainEqual(['config', evil]);
    });
  });

  describe('embedJson', () => {
    it('should escape the characters that could end a script or a string', (): void => {
      expect(embedJson({ id: '<a href="x">&</a>', line: 'a\u2028b\u2029c' })).toBe(
        '{"id":"\\u003ca href=\\"x\\"\\u003e\\u0026\\u003c/a\\u003e","line":"a\\u2028b\\u2029c"}'
      );
    });
  });

  describe('queue', () => {
    it('should replay the calls the snippet queued, in order, and take over msq', (): void => {
      const page: Page = new Page();
      page.paste();
      page.msq('conversion', { goal: 'purchase', value: 89, currency: 'EUR', orderId: 'A1' });
      page.msq('consent', { ads: 'granted' });
      page.msq('conversion', { goal: 'lead', orderId: 'L1' });
      const stub: unknown = page.window.msq;

      page.load();

      expect(page.window.msq).not.toBe(stub);
      expect(page.window.msq.loaded).toBe(true);
      expect(page.sources).toEqual([LOADER_URL, GTAG_URL]);
      expect(page.sent).toEqual([
        [
          'event',
          'conversion',
          { send_to: ['AW-111/abc', 'AW-222/def'], transaction_id: 'A1', value: 89, currency: 'EUR' },
        ],
        ['event', 'conversion', { send_to: ['AW-111/lead'], transaction_id: 'L1' }],
      ]);
    });

    it('should work when the tracking script runs without the snippet', (): void => {
      const page: Page = new Page();
      page.load();

      page.msq('consent', { ads: 'granted' });

      expect(page.sources).toEqual([GTAG_URL]);
    });

    it('should keep the first tracking script when it is loaded twice', (): void => {
      const page: Page = loadedPage();
      const first: unknown = page.window.msq;

      page.load();
      page.msq('consent', { ads: 'granted' });

      expect(page.window.msq).toBe(first);
      expect(page.sources).toEqual([LOADER_URL, GTAG_URL]);
    });

    it('should keep at most 50 conversions while consent is unknown', (): void => {
      const page: Page = loadedPage();
      for (let index = 0; index < 60; index++) page.msq('conversion', { goal: 'lead', orderId: `L${index}` });

      page.msq('consent', { ads: 'granted' });

      expect(page.sent).toHaveLength(50);
      expect(page.sent[49]).toEqual(['event', 'conversion', { send_to: ['AW-111/lead'], transaction_id: 'L49' }]);
    });
  });

  describe('consent', () => {
    it('should load and send nothing before consent is granted', (): void => {
      const page: Page = loadedPage();

      page.msq('conversion', { goal: 'purchase', value: 89, currency: 'EUR' });

      expect(page.sources).toEqual([LOADER_URL]);
      expect(page.window.dataLayer).toBeUndefined();
      expect(page.warnings).toEqual([]);
    });

    it('should load nothing and drop the queued conversions when consent is denied', (): void => {
      const page: Page = loadedPage();
      page.msq('conversion', { goal: 'purchase', value: 89, currency: 'EUR' });

      page.msq('consent', { ads: 'denied' });
      page.msq('conversion', { goal: 'lead' });

      expect(page.sources).toEqual([LOADER_URL]);
      expect(page.window.dataLayer).toBeUndefined();

      page.msq('consent', { ads: 'granted' });
      expect(page.sources).toEqual([LOADER_URL, GTAG_URL]);
      expect(page.sent).toEqual([]);
    });

    it('should load Google with denied defaults, then grant it, before its tag', (): void => {
      const page: Page = loadedPage();

      page.msq('consent', { ads: 'granted' });

      expect(page.sources).toEqual([LOADER_URL, GTAG_URL]);
      expect(page.scripts.every((script: FakeScript) => script.tagName === 'script' && script.async !== false)).toBe(
        true
      );
      expect(page.google).toEqual([
        ['consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }],
        ['consent', 'update', { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' }],
        ['js', expect.any(String)],
        ['config', 'AW-111'],
        ['config', 'AW-222'],
      ]);
    });

    it('should send the queued conversions once consent is granted', (): void => {
      const page: Page = loadedPage();
      page.msq('conversion', { goal: 'purchase', value: 89, currency: 'EUR', orderId: 'A123' });

      page.msq('consent', { ads: 'granted' });

      expect(page.sent).toEqual([
        [
          'event',
          'conversion',
          { send_to: ['AW-111/abc', 'AW-222/def'], transaction_id: 'A123', value: 89, currency: 'EUR' },
        ],
      ]);
    });

    it('should tell Google and stop sending when consent is withdrawn, and start again when granted', (): void => {
      const page: Page = loadedPage();
      page.msq('consent', { ads: 'granted' });

      page.msq('consent', { ads: 'denied' });
      page.msq('consent', { ads: 'denied' });
      page.msq('conversion', { goal: 'purchase', value: 89, currency: 'EUR' });

      expect(page.google.slice(-1)).toEqual([
        ['consent', 'update', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }],
      ]);
      expect(page.sent).toEqual([]);

      page.msq('consent', { ads: 'granted' });
      page.msq('consent', { ads: 'granted' });
      page.msq('conversion', { goal: 'lead', orderId: 'L1' });

      expect(page.sources).toEqual([LOADER_URL, GTAG_URL]);
      expect(page.google.filter((call: Call) => call[0] === 'consent').map((call: Call) => call[1])).toEqual([
        'default',
        'update',
        'update',
        'update',
      ]);
      expect(page.google.slice(-2)).toEqual([
        ['consent', 'update', { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' }],
        ['event', 'conversion', { send_to: ['AW-111/lead'], transaction_id: 'L1' }],
      ]);
    });

    it('should ignore a malformed consent call and say so once', (): void => {
      const page: Page = loadedPage();

      page.msq('consent', 'granted');
      page.msq('consent', { ads: 'yes' });
      page.msq('consent');

      expect(page.sources).toEqual([LOADER_URL]);
      expect(page.warnings).toEqual(['[omnipotent] msq("consent") expects { ads: "granted" } or { ads: "denied" }']);
    });

    it('should load nothing and change nothing for an Advertiser without Google tag', (): void => {
      const page: Page = loadedPage({ googleTagIds: [], goals: { lead: { ...LEAD, google: [] } } });

      page.msq('consent', { ads: 'granted' });
      page.msq('conversion', { goal: 'lead' });
      page.msq('consent', { ads: 'denied' });

      expect(page.sources).toEqual([LOADER_URL]);
      expect(page.window.dataLayer).toBeUndefined();
      expect(page.warnings).toEqual([]);
    });
  });

  describe('conversion values', () => {
    /**
     * What Google received for one conversion of a goal.
     *
     * @param goal - Its key
     * @param params - What the site sends
     * @returns The parameters of the event
     */
    function sentFor(goal: string, params: Record<string, unknown>): Record<string, unknown> {
      const page: Page = loadedPage();
      page.msq('consent', { ads: 'granted' });
      page.msq('conversion', { goal, orderId: 'X1', ...params });
      return page.sent[0][2] as Record<string, unknown>;
    }

    it('should send no value for a goal without value', (): void => {
      expect(sentFor('lead', { value: 10, currency: 'EUR' })).toEqual({
        send_to: ['AW-111/lead'],
        transaction_id: 'X1',
      });
    });

    it('should send the fixed value whatever the site sends', (): void => {
      expect(sentFor('quote', { value: 10, currency: 'EUR' })).toEqual({
        send_to: ['AW-111/quote'],
        transaction_id: 'X1',
        value: 120,
        currency: 'USD',
      });
    });

    it('should send the value the site sends for a dynamic goal', (): void => {
      expect(sentFor('purchase', { value: 19.9, currency: 'usd' })).toMatchObject({ value: 19.9, currency: 'USD' });
    });

    it.each([
      ['a numeric string', { value: ' 19.90 ', currency: 'EUR' }, 19.9, 'EUR'],
      ['a value without currency (the goal currency)', { value: 19.9 }, 19.9, 'EUR'],
      ['no value (the default)', {}, 50, 'EUR'],
      ['a value that is not a number (the default)', { value: 'free', currency: 'USD' }, 50, 'EUR'],
      ['a blank value (the default)', { value: '  ', currency: 'USD' }, 50, 'EUR'],
      ['a negative value (the default)', { value: -5, currency: 'USD' }, 50, 'EUR'],
      ['an infinite value (the default)', { value: Infinity, currency: 'USD' }, 50, 'EUR'],
      ['a malformed currency (the default)', { value: 19.9, currency: 'euros' }, 50, 'EUR'],
      ['a currency that is not a string (the default)', { value: 19.9, currency: 978 }, 50, 'EUR'],
    ])(
      'should resolve a dynamic value from %s',
      (_label: string, params: Record<string, unknown>, value: number, currency: string): void => {
        expect(sentFor('purchase', params)).toMatchObject({ value, currency });
      }
    );

    it('should send no value for a dynamic goal without currency nor default', (): void => {
      const page: Page = loadedPage();
      page.msq('consent', { ads: 'granted' });

      page.msq('conversion', { goal: 'subscription', value: 9.99, orderId: 'S1' });
      page.msq('conversion', { goal: 'subscription', value: 9.99, currency: 'EUR', orderId: 'S2' });

      expect(page.sent).toEqual([
        ['event', 'conversion', { send_to: ['AW-111/sub'], transaction_id: 'S1' }],
        ['event', 'conversion', { send_to: ['AW-111/sub'], transaction_id: 'S2', value: 9.99, currency: 'EUR' }],
      ]);
    });

    it.each([
      ['EUR', 89, 89],
      ['EUR', 1.005, 1.01],
      ['USD', 0.1 + 0.2, 0.3],
      ['JPY', 99.6, 100],
      ['KRW', 15000, 15000],
      ['ISK', 1290.4, 1290],
      ['KWD', 1.2345, 1.235],
      ['BHD', 12, 12],
      ['TND', 3.5, 3.5],
      ['CLF', 1.5, 1.5],
    ])(
      'should round %s %d to the minor unit of its currency',
      (currency: string, value: number, rounded: number): void => {
        expect(sentFor('purchase', { value, currency }).value).toBe(rounded);
      }
    );
  });

  describe('event ids', () => {
    it.each([
      ['a text order id', 'A-123', 'A-123'],
      ['a numeric order id', 123, '123'],
      ['a long order id (cut to 64)', 'x'.repeat(80), 'x'.repeat(64)],
    ])('should use %s as the transaction id', (_label: string, orderId: unknown, id: string): void => {
      const page: Page = loadedPage();
      page.msq('consent', { ads: 'granted' });

      page.msq('conversion', { goal: 'purchase', orderId });

      expect((page.sent[0][2] as Record<string, unknown>).transaction_id).toBe(id);
    });

    it('should generate one random id per conversion', (): void => {
      const uuids: string[] = ['uuid-1', 'uuid-2'];
      const page: Page = loadedPage(CONFIG, { crypto: { randomUUID: (): string => uuids.shift() as string } });
      page.msq('consent', { ads: 'granted' });

      page.msq('conversion', { goal: 'purchase', orderId: '' });
      page.msq('conversion', { goal: 'purchase' });

      expect(page.sent.map((call: Call) => (call[2] as Record<string, unknown>).transaction_id)).toEqual([
        'uuid-1',
        'uuid-2',
      ]);
    });

    it('should generate an id without crypto.randomUUID', (): void => {
      const page: Page = loadedPage(CONFIG, { crypto: {} });
      page.msq('consent', { ads: 'granted' });

      page.msq('conversion', { goal: 'purchase', orderId: NaN });
      page.msq('conversion', { goal: 'purchase' });

      const [first, second] = page.sent.map((call: Call): string => (call[2] as Record<string, string>).transaction_id);
      expect(first).toMatch(/^op-[0-9a-z]+-[0-9a-z]+$/);
      expect(second).toMatch(/^op-[0-9a-z]+-[0-9a-z]+$/);
      expect(first).not.toBe(second);
    });
  });

  describe('platform calls', () => {
    it('should do nothing for a goal Google does not measure yet', (): void => {
      const page: Page = loadedPage({ ...CONFIG, goals: { lead: { ...LEAD, google: [] } } });
      page.msq('consent', { ads: 'granted' });

      page.msq('conversion', { goal: 'lead' });

      expect(page.sent).toEqual([]);
      expect(page.warnings).toEqual([]);
    });

    it("should reuse the site's own dataLayer", (): void => {
      const dataLayer: unknown[] = [['site', 'entry']];
      const page: Page = loadedPage(CONFIG, { dataLayer });

      page.msq('consent', { ads: 'granted' });

      expect(page.window.dataLayer).toBe(dataLayer);
      expect(page.google[0]).toEqual(['site', 'entry']);
    });
  });

  describe('robustness', () => {
    it('should keep sending when Google throws, and say so once', (): void => {
      const page: Page = loadedPage();
      page.msq('consent', { ads: 'granted' });
      page.window.dataLayer.push = (): never => {
        throw new Error('dataLayer is broken');
      };

      expect((): void => {
        page.msq('conversion', { goal: 'purchase', orderId: 'A1' });
        page.msq('conversion', { goal: 'purchase', orderId: 'A2' });
      }).not.toThrow();
      expect(page.warnings).toEqual(['[omnipotent] google call failed: dataLayer is broken']);
    });

    it('should survive a failure that is not an error, and a console that throws', (): void => {
      const page: Page = loadedPage(CONFIG, {
        console: {
          warn: (): never => {
            throw new Error('no console');
          },
        },
      });
      page.msq('consent', { ads: 'granted' });
      page.window.dataLayer.push = (): never => {
        throw 'not an error';
      };

      expect((): void => page.msq('conversion', { goal: 'purchase' })).not.toThrow();
    });

    it('should report an unknown goal, command or malformed conversion once each', (): void => {
      const page: Page = loadedPage();
      page.msq('consent', { ads: 'granted' });

      page.msq('conversion', { goal: 'nope' });
      page.msq('conversion', { goal: 'nope' });
      page.msq('conversion', 'purchase');
      page.msq('conversion');
      page.msq('track', {});
      page.msq('track', {});

      expect(page.warnings).toEqual([
        '[omnipotent] unknown conversion goal "nope"',
        '[omnipotent] msq("conversion") expects { goal: "<key>", value, currency, orderId }',
        '[omnipotent] unknown command "track"',
      ]);
    });

    it('should report a call that fails as a whole', (): void => {
      const page: Page = loadedPage();

      page.window.msq.call(null, 'consent', {
        get ads(): never {
          throw new Error('getter failed');
        },
      });

      expect(page.warnings).toEqual(['[omnipotent] msq call failed: getter failed']);
    });
  });
});
