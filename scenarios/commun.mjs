/**
 * What the scenarios share: the terminal, the calls to the API, the choice of the Organization and of
 * the brand, and what is printed of the platforms. Code in English, what is printed in French, for
 * Lorin.
 */
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { deflateSync } from 'node:zlib';

/**
 * The settings of a scenario: its defaults, then Lorin's own values from `config.local.mjs`, which
 * git ignores — a token or an id written in a committed script would reach the public repository.
 *
 * @param {object} defaults - The scenario's defaults
 * @returns {Promise<object>} The settings
 */
export async function loadConfig(defaults) {
  const config = { ...defaults };
  try {
    Object.assign(config, (await import('./config.local.mjs')).default);
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  }
  return config;
}

/** The terminal, opened at the first question and shared by all of them. */
let reader;

/** The lines typed, in order: one read per question, none lost when several come at once. */
let lines;

/** Whether what is typed is hidden: a secret is being entered. */
let muted = false;

/**
 * Ask a question in the terminal.
 *
 * @param {string} question - What is asked
 * @param {{ hidden?: boolean }} [options] - `hidden` for a secret: what is typed is not shown
 * @returns {Promise<string>} The answer, trimmed; empty when nothing more can be read
 */
export async function ask(question, { hidden = false } = {}) {
  if (!reader) {
    // The terminal echoes through this, which keeps quiet while a secret is typed.
    const output = new Writable({
      write(chunk, encoding, done) {
        if (!muted) process.stdout.write(chunk, encoding);
        done();
      },
    });
    reader = createInterface({ input: process.stdin, output, terminal: true });
    lines = reader[Symbol.asyncIterator]();
  }
  process.stdout.write(question);
  muted = hidden;
  const { value = '' } = await lines.next();
  muted = false;
  if (hidden) process.stdout.write('\n');
  return value.trim();
}

/** Close the terminal, so the scenario can end. */
export function closeTerminal() {
  reader?.close();
}

let step = 0;

/**
 * Print the title of a step.
 *
 * @param {string} text - What the step does
 */
export function title(text) {
  step += 1;
  console.log(`\n\x1b[1m${step}. ${text}\x1b[0m`);
}

/**
 * Print one line of a step's outcome.
 *
 * @param {string} line - The line
 */
export function say(line) {
  console.log(`   ${line}`);
}

/**
 * Stop the scenario, saying why.
 *
 * @param {string} reason - Why
 * @returns {never}
 */
export function stop(reason) {
  console.error(`\n\x1b[31m✗ ${reason}\x1b[0m`);
  process.exit(1);
}

/**
 * Wait.
 *
 * @param {number} ms - How long
 * @returns {Promise<void>}
 */
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ask the token when the settings have none.
 *
 * @param {object} config - The settings, completed here
 * @returns {Promise<void>}
 */
export async function ensureToken(config) {
  if (!config.token) {
    console.log(
      'Ton jeton : dans le Swagger, « Authorize », exécute une route, et copie ce qui suit « Bearer » dans la boîte Curl.'
    );
    config.token = await ask('Jeton (il ne s’affiche pas) : ', { hidden: true });
  }
  if (!config.token) stop('Il faut un jeton.');
}

/**
 * What calls the API as the person whose token this is, and stops on a refusal, printing its code.
 *
 * @param {object} config - The settings: the API, the token, the Organization
 * @returns {(method: string, path: string, body?: object) => Promise<any>} The call
 */
export function createApi(config) {
  return async (method, path, body) => {
    const headers = { authorization: `Bearer ${config.token}`, 'x-organization-id': config.organizationId };
    const init = { method, headers };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const response = await fetch(`${config.url}${path}`, init);
    const text = await response.text();
    const answer = text ? JSON.parse(text) : null;
    if (!response.ok) {
      stop(
        `${method} ${path} → ${response.status} ${answer?.code ?? ''}\n  ${answer?.message ?? text}` +
          (answer?.params ? `\n  ${JSON.stringify(answer.params)}` : '')
      );
    }
    return answer;
  };
}

/**
 * Pick one item among several: the only one, or the one asked.
 *
 * @param {any[]} items - The items
 * @param {(item: any) => string} label - How one is shown
 * @returns {Promise<any>} The item, `undefined` when there is none
 */
export async function pick(items, label) {
  if (items.length <= 1) return items[0];
  items.forEach((item, index) => say(`${index + 1}. ${label(item)}`));
  return items[Number(await ask('   Lequel (son numéro) : ')) - 1];
}

/**
 * The Organization to work in: the one of the settings, else the only one, else the one asked —
 * read from `GET /me`, as omnipass resolved the caller.
 *
 * @param {Function} call - The API
 * @param {object} config - The settings, completed here
 * @returns {Promise<object>} The Organization
 */
export async function chooseOrganization(call, config) {
  title('Toi, et ton Organization');
  const me = await call('GET', '/me');
  say(`${me.user.name ?? me.user.email} — ${me.organizations.length} Organization(s)`);
  const organization = config.organizationId
    ? me.organizations.find((one) => one.id === config.organizationId)
    : await pick(me.organizations, (one) => `${one.name} (rôle ${one.role})`);
  if (!organization) stop('Aucune Organization à prendre : omnipass ne t’en donne aucune, ou pas celle du réglage.');
  config.organizationId = organization.id;
  say(`${organization.name}, rôle ${organization.role} (${organization.id})`);
  return organization;
}

/**
 * The brand to work for: the one of the settings, else the only one, else the one asked — created
 * when the Organization has none and the scenario may create one.
 *
 * @param {Function} call - The API
 * @param {object} config - The settings
 * @param {{ create?: boolean }} [options] - Whether a brand may be created
 * @returns {Promise<object>} The brand
 */
export async function chooseAdvertiser(call, config, { create = false } = {}) {
  title('La marque');
  const advertisers = (await call('GET', '/advertisers?limit=100')).items;
  let advertiser = config.advertiserId
    ? advertisers.find((one) => one.id === config.advertiserId)
    : await pick(advertisers, (one) => one.name);
  if (!advertiser && config.advertiserId) stop('La marque du réglage n’est pas dans cette Organization.');
  if (!advertiser && !create) stop('Aucune marque dans cette Organization.');
  if (!advertiser) {
    say('Aucune marque dans cette Organization : le scénario en crée une.');
    const name = await ask('   Son nom : ');
    const site = config.site || (await ask('   Son vrai site, que Google examinera (https://…) : '));
    advertiser = await call('POST', '/advertisers', { name, websiteUrl: site });
  }
  say(`${advertiser.name}${advertiser.websiteUrl ? `, ${advertiser.websiteUrl}` : ''} (${advertiser.id})`);
  return advertiser;
}

/** What each verdict of a platform reads as, in French. */
const VERDICTS = {
  pending: '\x1b[33men examen\x1b[0m',
  approved: '\x1b[32mapprouvée\x1b[0m',
  limited: '\x1b[33mlimitée\x1b[0m (approuvée, montrée à moins de monde)',
  rejected: '\x1b[31mrefusée\x1b[0m',
};

/**
 * A verdict of a platform on an ad, in French, with its reasons as the platform words them.
 *
 * @param {{ status: string, reasons: string[] } | null} review - The verdict, `null` before any was read
 * @returns {string} The text
 */
export function verdictText(review) {
  if (!review) return 'verdict pas encore lu';
  return `${VERDICTS[review.status] ?? review.status}${review.reasons.length > 0 ? ` — ${review.reasons.join(', ')}` : ''}`;
}

/**
 * Print where each unit of a campaign stands at its platforms, and the verdict of each ad.
 *
 * @param {object[]} units - The units, as `GET /campaigns/:id/platform-status` answers them
 */
export function printUnits(units) {
  for (const unit of units) {
    say(
      `${unit.platform} — synchro ${unit.state}, ${unit.attempts} tentative(s)` +
        (unit.errorCode || unit.errorMessage ? ` — erreur ${unit.errorCode ?? ''} ${unit.errorMessage ?? ''}` : '')
    );
    for (const object of unit.objects ?? []) {
      say(
        `   ${object.object} ${object.key} → ${object.externalId ?? 'pas encore créé'}` +
          (object.level === 'line' ? ` — ${verdictText(object.review)}` : '')
      );
    }
  }
}

/**
 * Wait until no unit of a campaign waits for its synchronization, and say so when nothing ever tries:
 * the API only queues the jobs, a worker runs them.
 *
 * @param {Function} call - The API
 * @param {string} campaignId - The campaign
 * @param {number} [seconds] - Longest wait
 * @returns {Promise<object[]>} The units, as they stand
 */
export async function settled(call, campaignId, seconds = 120) {
  let units = [];
  for (let waited = 5; waited <= seconds; waited += 5) {
    await wait(5_000);
    units = (await call('GET', `/campaigns/${campaignId}/platform-status`)).units ?? [];
    if (units.length > 0 && units.every((unit) => unit.state !== 'pending')) {
      say(`synchro faite en moins de ${waited} s`);
      return units;
    }
  }
  if (units.some((unit) => unit.state === 'pending' && unit.attempts === 0)) {
    console.log(
      '\n\x1b[33m⚠ La synchro n’a jamais été tentée : aucun worker ne traite les jobs. Dans backend/ :' +
        '\n  pnpm start:worker\nElle part alors toute seule, dans la minute.\x1b[0m'
    );
  }
  return units;
}

/**
 * Print the calls made to a platform, the account number masked: what a synchronization sent.
 *
 * @param {object[]} calls - The calls, as `GET /ad-accounts/:id/platform-calls` answers them
 */
export function printCalls(calls) {
  if (calls.length === 0) {
    say('\x1b[32mAucun appel à la plateforme.\x1b[0m');
    return;
  }
  for (const one of calls) {
    const kind = one.path.endsWith(':mutate') ? `changement, ${one.operations} opération(s)` : 'lecture';
    say(
      `${one.createdAt.slice(11, 19)} ${one.method} ${one.path.replace(/customers\/\d+/, 'customers/…')} → ` +
        `${one.statusCode ?? 'sans réponse'} — ${kind}${one.error ? ` — ${one.error}` : ''}`
    );
  }
  const changes = calls.filter((one) => one.path.endsWith(':mutate'));
  say(
    `En tout : ${calls.length - changes.length} lecture(s), ${changes.length} changement(s) de ` +
      `${changes.reduce((sum, one) => sum + one.operations, 0)} opération(s).`
  );
}

/**
 * A plain square PNG, generated here so the scenario needs no file: Google wants a square logo of at
 * least 128 pixels.
 *
 * @param {number} side - Its side, in pixels
 * @returns {Buffer} The PNG
 */
export function squarePng(side) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(side * 3, 0)]);
  for (let x = 0; x < side; x += 1) row.set([236, 72, 153], 1 + x * 3); // pink
  const pixels = deflateSync(Buffer.concat(Array.from({ length: side }, () => row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', pixels),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * A day, `days` after today in Paris.
 *
 * @param {number} days - How many days after today
 * @returns {string} `YYYY-MM-DD`
 */
export function dayIn(days) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  return new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
