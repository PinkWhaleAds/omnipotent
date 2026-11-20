#!/usr/bin/env node
/**
 * Scenario: a Google Search campaign of 10 € in all, built through the local API step by step, its
 * preview read — then, if asked, launched and paused at once (`backend/docs/phase-10.md` § 1 and
 * § 8.6). Every call and its outcome are printed, in French, for Lorin.
 *
 * Run from the repository root, the API and a worker running locally (`scenarios/README.md`):
 *
 *   node scenarios/campagne-google.mjs
 *
 * Its settings are in CONFIG; Lorin's own values go in `config.local.mjs`, which git ignores — never
 * here: this file is committed, and the repository is public. Whatever is left empty is asked.
 */
import {
  ask,
  chooseAdvertiser,
  chooseOrganization,
  closeTerminal,
  createApi,
  dayIn,
  ensureToken,
  loadConfig,
  printUnits,
  say,
  settled,
  squarePng,
  stop,
  title,
} from './commun.mjs';

/** What the scenario needs, before `config.local.mjs`. Empty: asked at launch. */
const CONFIG = await loadConfig({
  /** The API. */
  url: 'http://localhost:3002',
  /** Your token, from the Swagger. Empty here, always: in `config.local.mjs`, or asked without showing. */
  token: '',
  /** The Organization. Empty: yours are read from /me, and asked when several. */
  organizationId: '',
  /** The brand. Empty: the brands of the Organization are listed, and asked when there are several. */
  advertiserId: '',
  /** The page every ad leads to, which Google reviews. Empty: the brand's own site, else asked. */
  site: '',
  /** The keywords, matched as phrases; « gratuit » is added as a negative one. */
  keywords: ['devis gratuit', 'prise de rendez-vous', 'conseil personnalisé'],
  /** Whether to launch, then pause at once. `null`: asked once the preview is clean. */
  launch: null,
});

await ensureToken(CONFIG);
const call = createApi(CONFIG);
console.log(`\nScénario « campagne Google à 10 € » contre ${CONFIG.url}`);

await chooseOrganization(call, CONFIG);
const advertiser = await chooseAdvertiser(call, CONFIG, { create: true });
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
  closeTerminal();
  process.exit(0);
}

title('Le lancement, puis la pause aussitôt');
await call('POST', `/campaigns/${campaign.id}/launch`);
say('Lancée.');
await call('PUT', `/campaigns/${campaign.id}/status`, { status: 'paused' });
say('En pause.');

title('Ce que Google a reçu');
printUnits(await settled(call, campaign.id));
closeTerminal();
console.log(
  `\nRegarde maintenant dans Google Ads la campagne dont le nom se termine par [op:…] : en pause, ` +
    `avec son budget, son pays et son rayon, ses mots-clés, ses deux annonces, ses extensions et son logo.`
);
