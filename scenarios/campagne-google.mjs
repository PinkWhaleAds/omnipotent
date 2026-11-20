#!/usr/bin/env node
/**
 * Scenario: a Google Search campaign of 10 € in all, built through the local API step by step, its
 * preview read — then, if asked, launched and paused at once (`backend/docs/phase-10.md` § 1 and
 * § 8.6). Every call and its outcome are printed, in French, for Lorin.
 *
 * Run from the repository root, the API running locally (`pnpm start:dev` in `backend/`):
 *
 *   node scenarios/campagne-google.mjs
 *
 * What the scenario needs is set in CONFIG just below; whatever is left empty is asked at launch.
 */
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { deflateSync } from 'node:zlib';

/**
 * What the scenario needs. Empty: asked at launch. **Your own values go in `config.local.mjs`**, beside
 * this file, which git ignores — never here: this file is committed, and the repository is public.
 */
const CONFIG = {
  /** The API. */
  url: 'http://localhost:3002',
  /** Your token, from the Swagger. Empty here, always: in `config.local.mjs`, or asked without showing. */
  token: '',
  /** The Organization to create the campaign in. Empty: yours are read from /me, and asked when several. */
  organizationId: '',
  /** The brand. Empty: the brands of the Organization are listed, and asked when there are several. */
  advertiserId: '',
  /** The page every ad leads to, which Google reviews. Empty: the brand's own site, else asked. */
  site: '',
  /** The keywords, matched as phrases; « gratuit » is added as a negative one. */
  keywords: ['devis gratuit', 'prise de rendez-vous', 'conseil personnalisé'],
  /** Whether to launch, then pause at once. `null`: asked once the preview is clean. */
  launch: null,
};

// Your own values, kept out of git: `export default { organizationId: '…', token: '…' }`.
try {
  Object.assign(CONFIG, (await import('./config.local.mjs')).default);
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
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
async function ask(question, { hidden = false } = {}) {
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

let step = 0;

/**
 * Print the title of a step.
 *
 * @param {string} title - What the step does
 */
function title(title) {
  step += 1;
  console.log(`\n\x1b[1m${step}. ${title}\x1b[0m`);
}

/**
 * Print one line of a step's outcome.
 *
 * @param {string} line - The line
 */
function say(line) {
  console.log(`   ${line}`);
}

/**
 * Stop the scenario, saying why.
 *
 * @param {string} reason - Why
 * @returns {never}
 */
function stop(reason) {
  console.error(`\n\x1b[31m✗ ${reason}\x1b[0m`);
  process.exit(1);
}

/**
 * Call the API as the person whose token this is, and stop on a refusal, printing its stable code.
 *
 * @param {string} method - HTTP method
 * @param {string} path - Path, query included
 * @param {object} [body] - JSON body, or a FormData
 * @returns {Promise<any>} The answer
 */
async function call(method, path, body) {
  const headers = { authorization: `Bearer ${CONFIG.token}`, 'x-organization-id': CONFIG.organizationId };
  const init = { method, headers };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`${CONFIG.url}${path}`, init);
  const text = await response.text();
  const answer = text ? JSON.parse(text) : null;
  if (!response.ok) {
    stop(
      `${method} ${path} → ${response.status} ${answer?.code ?? ''}\n  ${answer?.message ?? text}` +
        (answer?.params ? `\n  ${JSON.stringify(answer.params)}` : '')
    );
  }
  return answer;
}

/**
 * A plain square PNG, generated here so the scenario needs no file: Google wants a square logo of at
 * least 128 pixels.
 *
 * @param {number} side - Its side, in pixels
 * @returns {Buffer} The PNG
 */
function squarePng(side) {
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
function dayIn(days) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  return new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Wait.
 *
 * @param {number} ms - How long
 * @returns {Promise<void>}
 */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Print where each unit of the campaign stands at its platforms.
 *
 * @param {string} campaignId - The campaign
 * @returns {Promise<any[]>} The units
 */
async function platformStatus(campaignId) {
  const status = await call('GET', `/campaigns/${campaignId}/platform-status`);
  for (const unit of status.units ?? []) {
    say(
      `${unit.platform} — synchro ${unit.state}, ${unit.attempts} tentative(s)` +
        (unit.errorCode || unit.errorMessage ? ` — erreur ${unit.errorCode ?? ''} ${unit.errorMessage ?? ''}` : '')
    );
    for (const object of unit.objects ?? [])
      say(`   ${object.object} ${object.key} → ${object.externalId ?? 'pas encore créé'}`);
  }
  return status.units ?? [];
}

if (!CONFIG.token) {
  console.log(
    'Ton jeton : dans le Swagger, « Authorize », exécute une route, et copie ce qui suit « Bearer » dans la boîte Curl.'
  );
  CONFIG.token = await ask('Jeton (il ne s’affiche pas) : ', { hidden: true });
}
if (!CONFIG.token) stop('Il faut un jeton.');

console.log(`\nScénario « campagne Google à 10 € » contre ${CONFIG.url}`);

title('Toi, et ton Organization');
const me = await call('GET', '/me');
say(`${me.user.name ?? me.user.email} — ${me.organizations.length} Organization(s)`);
let organization = me.organizations.find((one) => one.id === CONFIG.organizationId);
if (!organization && !CONFIG.organizationId && me.organizations.length === 1) [organization] = me.organizations;
if (!organization && !CONFIG.organizationId && me.organizations.length > 1) {
  me.organizations.forEach((one, index) => say(`${index + 1}. ${one.name} (rôle ${one.role})`));
  organization = me.organizations[Number(await ask('   Laquelle (son numéro) : ')) - 1];
}
if (!organization) stop('Aucune Organization à prendre : omnipass ne t’en donne aucune, ou pas celle du réglage.');
CONFIG.organizationId = organization.id;
say(`${organization.name}, rôle ${organization.role} (${organization.id})`);

title('La marque');
const advertisers = (await call('GET', '/advertisers?limit=100')).items;
let advertiser = CONFIG.advertiserId
  ? advertisers.find((one) => one.id === CONFIG.advertiserId)
  : advertisers.length === 1
    ? advertisers[0]
    : undefined;
if (!advertiser && !CONFIG.advertiserId && advertisers.length > 1) {
  advertisers.forEach((one, index) => say(`${index + 1}. ${one.name}`));
  advertiser = advertisers[Number(await ask('   Laquelle (son numéro) : ')) - 1];
}
if (!advertiser && CONFIG.advertiserId) stop('La marque du réglage n’est pas dans cette Organization.');
if (!advertiser) {
  say('Aucune marque dans cette Organization : le scénario en crée une.');
  const name = await ask('   Son nom : ');
  const site = CONFIG.site || (await ask('   Son vrai site, que Google examinera (https://…) : '));
  advertiser = await call('POST', '/advertisers', { name, websiteUrl: site });
}
say(`${advertiser.name}${advertiser.websiteUrl ? `, ${advertiser.websiteUrl}` : ''} (${advertiser.id})`);
// The page every ad leads to: the setting, else the brand's own site, else asked.
CONFIG.site ||= advertiser.websiteUrl ?? (await ask('   Son vrai site, que Google examinera (https://…) : '));
if (!/^https?:\/\//.test(CONFIG.site)) stop('Il faut le site de la marque, en http(s).');

title('Le compte Google connecté, relié à la marque');
const accounts = (await call('GET', '/ad-accounts?platform=google_ads&status=active&limit=100')).items;
if (accounts.length === 0) stop('Aucun compte Google actif dans cette Organization : connecte-le d’abord.');
const account = accounts[0];
say(`${account.name}, ${account.currency}, ${account.timezone} (${account.id})`);
const links = await call('GET', `/advertisers/${advertiser.id}/ad-accounts`);
const linked = links.items.find((link) => link.platform === 'google_ads' && link.currency === account.currency);
if (linked) say('Déjà reliée : rien à faire.');
else {
  await call('POST', `/advertisers/${advertiser.id}/ad-accounts`, {
    adAccountId: account.id,
    externalAdvertiserId: account.externalId,
  });
  say('Reliée.');
}

title('La campagne : 10 € au total, sur une semaine');
const startsOn = dayIn(1);
const campaign = await call('POST', `/advertisers/${advertiser.id}/campaigns`, {
  name: `Test Omnipotent ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
  currency: account.currency,
  startsOn,
  startTime: '09:00',
  endsOn: dayIn(7),
  budgetCents: 1_000,
  containsPoliticalAdvertising: false,
});
say(`${campaign.name} — du ${campaign.startsOn} à ${campaign.startTime} au ${campaign.endsOn} (${campaign.id})`);

title('Le levier Search, tout chez Google, avec ses extensions');
const lever = await call('POST', `/campaigns/${campaign.id}/levers`, {
  lever: 'search',
  platformShares: [{ platform: 'google_ads', shareBasisPoints: 10_000 }],
  platformSettings: { google_ads: { searchPartners: false, aiMax: false } },
  extensions: {
    sitelinks: [{ text: 'Nous contacter', finalUrl: CONFIG.site }],
    callouts: ['Réponse rapide', 'Conseil gratuit'],
    structuredSnippets: [],
  },
});
say(`Partenaires de recherche : non ; AI Max : non ; 1 lien annexe, 2 accroches (${lever.id})`);

title('L’AdGroup : CPC manuel à 0,50 €');
const adGroup = await call('POST', `/levers/${lever.id}/ad-groups`, {
  name: 'Paris',
  bidStrategy: 'max_cpc',
  bidAmountCents: 50,
  locationIntent: 'presence',
});
say(`${adGroup.name}, ${adGroup.bidStrategy}, ${adGroup.bidAmountCents} centimes (${adGroup.id})`);

title('Le ciblage : la France, et 20 km autour de Paris');
const node = await call('POST', `/ad-groups/${adGroup.id}/targeting-groups`, { name: 'Île-de-France' });
await call('PUT', `/targeting-groups/${node.id}/targeting`, {
  targeting: {
    country: { include: ['FR'] },
    proximity: { points: [{ latitude: 48.8566, longitude: 2.3522, radiusKm: 20, label: 'Paris' }] },
  },
});
say(`${node.name} (${node.id})`);

title('Les mots-clés');
await call('POST', `/targeting-groups/${node.id}/keywords`, {
  mode: 'atomic',
  keywords: [...CONFIG.keywords.map((text) => ({ text, matchType: 'phrase' })), { text: 'gratuit', negative: true }],
});
say(`${CONFIG.keywords.map((keyword) => `« ${keyword} »`).join(', ')} en expression, et « gratuit » en négatif`);

title('Le logo, carré, dans la bibliothèque');
const form = new FormData();
form.append('file', new Blob([squarePng(256)], { type: 'image/png' }), 'logo-scenario.png');
const logo = await call('POST', `/advertisers/${advertiser.id}/assets`, form);
say(`${logo.fileName}, ${logo.width}×${logo.height} (${logo.id})`);

title('Deux annonces responsives, l’une avec le logo');
const texts = (variant) => ({
  headlines: [`Votre projet ${variant}`, 'Un conseil sur mesure', 'Prenez rendez-vous'],
  descriptions: ['Une équipe à votre écoute pour vous accompagner.', 'Demandez votre devis en ligne, sans engagement.'],
  displayPaths: ['contact'],
  businessName: advertiser.name.slice(0, 25),
});
const withLogo = await call('POST', `/advertisers/${advertiser.id}/creatives`, {
  name: 'Annonce A (logo)',
  format: 'search_text',
  subtype: 'rsa',
  version: { payload: texts('A'), assets: [{ role: 'logo', assetId: logo.id }] },
});
const plain = await call('POST', `/advertisers/${advertiser.id}/creatives`, {
  name: 'Annonce B',
  format: 'search_text',
  subtype: 'rsa',
  version: { payload: texts('B') },
});
say(`${withLogo.name} (${withLogo.id})`);
say(`${plain.name} (${plain.id})`);

title('Les deux Lines, chacune avec sa créa et la page du site');
for (const creative of [withLogo, plain]) {
  const line = await call('POST', `/targeting-groups/${node.id}/lines`, {
    name: creative.name,
    creativeId: creative.id,
    landingPageUrl: CONFIG.site,
  });
  say(`${line.name} → ${line.landingPageUrl} (${line.id})`);
}

title('La preview');
const preview = await call('GET', `/campaigns/${campaign.id}/preview`);
for (const platform of preview.platforms) {
  const objects = Object.entries(platform.objects)
    .map(([kind, count]) => `${count} ${kind}`)
    .join(', ');
  say(`${platform.platform} : ${(platform.effectiveCents / 100).toFixed(2)} € — ${objects}`);
}
for (const finding of preview.errors) say(`\x1b[31merreur\x1b[0m ${finding.code} ${JSON.stringify(finding.params)}`);
for (const finding of preview.warnings) say(`avertissement ${finding.code} ${JSON.stringify(finding.params)}`);
if (!preview.launchable) stop('La preview bloque le lancement : corrige ce qu’elle dit, puis relance le scénario.');
say('Rien ne bloque le lancement.');

const launch =
  CONFIG.launch ??
  /^o(ui)?$/i.test(await ask('\nLa lancer chez Google, puis la mettre en pause aussitôt ? (oui/non) : '));
if (!launch) {
  console.log(`\nCampagne ${campaign.id} prête, en brouillon. Rien n’est parti chez Google.`);
  reader?.close();
  process.exit(0);
}

title('Le lancement, puis la pause aussitôt');
await call('POST', `/campaigns/${campaign.id}/launch`);
say('Lancée.');
await call('PUT', `/campaigns/${campaign.id}/status`, { status: 'paused' });
say('En pause.');

title('Ce que Google a reçu');
let units = [];
for (let attempt = 1; attempt <= 12; attempt += 1) {
  await wait(5_000);
  console.log(`   — après ${attempt * 5} s`);
  units = await platformStatus(campaign.id);
  if (units.length > 0 && units.every((unit) => unit.state !== 'pending')) break;
}
// Still waiting, never tried: no worker runs the jobs — the API only queues them.
if (units.some((unit) => unit.state === 'pending' && unit.attempts === 0)) {
  console.log(
    '\n\x1b[33m⚠ La synchro n’a jamais été tentée : aucun worker ne traite les jobs. Dans backend/ :' +
      '\n  APP_PORT=3012 pnpm start:worker\nElle part alors toute seule, dans la minute.\x1b[0m'
  );
}
reader?.close();
console.log(
  `\nRegarde maintenant dans Google Ads la campagne dont le nom se termine par [op:…] : en pause, ` +
    `avec son budget, son pays et son rayon, ses mots-clés, ses deux annonces, ses extensions et son logo.`
);
