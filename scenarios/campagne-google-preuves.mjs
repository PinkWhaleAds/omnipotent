#!/usr/bin/env node
/**
 * Scenario: the proofs of lot 3a that follow the first campaign (`backend/docs/phase-10.md` § 8.6),
 * played on a campaign `campagne-google.mjs` launched and paused:
 *
 * 1. a modification: only what changed reaches Google — one keyword, one operation;
 * 2. a synchronization with nothing changed: no call at all;
 * 3. an AdGroup added after the launch: paused, absent from Google; then activated, and present;
 * 4. an error provoked — a country Google does not target —, raised with its stable code, then mended.
 *
 * Everything stays paused at Google: the campaign is. Every call and its outcome are printed, in
 * French, for Lorin. Run from the repository root, the API and a worker running locally:
 *
 *   node scenarios/campagne-google-preuves.mjs
 *
 * Lorin's own values go in `config.local.mjs`, which git ignores; whatever is left empty is asked.
 */
import {
  chooseAdvertiser,
  chooseOrganization,
  closeTerminal,
  createApi,
  ensureToken,
  loadConfig,
  pick,
  printCalls,
  printUnits,
  say,
  settled,
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
  /** The brand. Empty: the only one, else asked. */
  advertiserId: '',
  /** The launched campaign. Empty: the only one, else asked, the latest first. */
  campaignId: '',
});

await ensureToken(CONFIG);
const call = createApi(CONFIG);
console.log(`\nScénario « les preuves de la campagne Google » contre ${CONFIG.url}`);

await chooseOrganization(call, CONFIG);
const advertiser = await chooseAdvertiser(call, CONFIG);

title('La campagne lancée');
const launched = (await call('GET', `/advertisers/${advertiser.id}/campaigns?limit=100`)).items
  .filter((one) => one.status === 'active' || one.status === 'paused')
  .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
const campaign = CONFIG.campaignId
  ? launched.find((one) => one.id === CONFIG.campaignId)
  : await pick(launched, (one) => `${one.name} (${one.status})`);
if (!campaign) stop('Aucune campagne lancée pour cette marque : joue d’abord scenarios/campagne-google.mjs.');
say(`${campaign.name}, ${campaign.status} (${campaign.id})`);

const lever = (await call('GET', `/campaigns/${campaign.id}/levers`)).items.find((one) => one.lever === 'search');
if (!lever) stop('Cette campagne n’a pas de levier Search.');
const [adGroup] = (await call('GET', `/levers/${lever.id}/ad-groups?limit=100`)).items.sort((left, right) =>
  left.createdAt.localeCompare(right.createdAt)
);
const [node] = (await call('GET', `/ad-groups/${adGroup.id}/targeting-groups?limit=100`)).items;
const [sample] = (await call('GET', `/targeting-groups/${node.id}/lines?limit=100`)).items;
const units = (await call('GET', `/campaigns/${campaign.id}/platform-status`)).units ?? [];
if (units.length === 0) stop('Cette campagne n’a rien chez Google : sa synchro n’a jamais eu lieu.');
const accountId = units[0].adAccountId;
say(`AdGroup « ${adGroup.name} », ciblage « ${node.name} », ${units.length} unité(s) chez Google`);

/**
 * The calls made to Google for the account since an instant.
 *
 * @param {string} since - ISO 8601
 * @returns {Promise<object[]>} The calls
 */
async function callsSince(since) {
  return (await call('GET', `/ad-accounts/${accountId}/platform-calls?since=${encodeURIComponent(since)}&limit=200`))
    .items;
}

/**
 * Do something, wait for the synchronization it causes, and print what reached Google.
 *
 * @param {() => Promise<void>} action - What is done
 * @returns {Promise<object[]>} The units once settled
 */
async function proof(action) {
  const since = new Date().toISOString();
  await action();
  const after = await settled(call, campaign.id);
  printCalls(await callsSince(since));
  return after;
}

const stamp = new Date().toISOString().slice(11, 19).replaceAll(':', '');

title('Preuve : une modification — seul ce qui a changé part');
say('Attendu : des lectures, puis un seul changement d’une seule opération, le mot-clé.');
await proof(async () => {
  await call('POST', `/targeting-groups/${node.id}/keywords`, {
    mode: 'atomic',
    keywords: [{ text: `preuve omnipotent ${stamp}`, matchType: 'phrase' }],
  });
  say(`Mot-clé « preuve omnipotent ${stamp} » ajouté.`);
});

title('Preuve : rien n’a changé — aucun appel');
say('Attendu : aucun appel à Google, la synchro voyant que rien n’a bougé.');
await proof(async () => {
  await call('POST', `/campaigns/${campaign.id}/sync`);
  say('Synchro demandée à la main.');
});

title('Preuve : un AdGroup ajouté après le lancement — en pause, absent de Google');
let added;
let addedNode;
const before = await proof(async () => {
  added = await call('POST', `/levers/${lever.id}/ad-groups`, {
    name: `Preuve ajout ${stamp}`,
    bidStrategy: 'max_cpc',
    bidAmountCents: 50,
    locationIntent: 'presence',
  });
  say(`AdGroup « ${added.name} » créé : statut ${added.status}.`);
  addedNode = await call('POST', `/ad-groups/${added.id}/targeting-groups`, { name: 'Preuve ajout' });
  await call('PUT', `/targeting-groups/${addedNode.id}/targeting`, { targeting: { country: { include: ['FR'] } } });
  await call('POST', `/targeting-groups/${addedNode.id}/keywords`, {
    mode: 'atomic',
    keywords: [{ text: `preuve ajout ${stamp}`, matchType: 'phrase' }],
  });
  await call('POST', `/targeting-groups/${addedNode.id}/lines`, {
    name: 'Preuve ajout',
    creativeId: sample.creativeId,
    landingPageUrl: sample.landingPageUrl,
  });
  say('Son ciblage, son mot-clé et son annonce sont écrits.');
  say('Il prend sa part du budget du levier : l’AdGroup existant en perd autant chez Google.');
});
say(
  before.some((unit) => unit.adGroupId === added.id)
    ? '\x1b[31m✗ L’AdGroup ajouté a une unité : il n’aurait rien dû envoyer.\x1b[0m'
    : '\x1b[32mL’AdGroup ajouté n’a aucune unité : rien de lui n’est parti chez Google.\x1b[0m'
);

title('Preuve : le même AdGroup activé — il apparaît chez Google');
const after = await proof(async () => {
  const change = await call('PUT', `/ad-groups/${added.id}/status`, { status: 'active' });
  say(`Activé : statut ${change.status}.`);
});
const unit = after.find((one) => one.adGroupId === added.id);
if (!unit) say('\x1b[31m✗ Toujours aucune unité pour l’AdGroup activé.\x1b[0m');
else printUnits([unit]);

title('Preuve : une erreur provoquée, remontée avec son code');
say('Un pays que Google ne cible pas : « XX ». Attendu : l’unité en erreur, avec son code.');
const broken = await proof(async () => {
  await call('PUT', `/targeting-groups/${addedNode.id}/targeting`, { targeting: { country: { include: ['XX'] } } });
});
printUnits(broken.filter((one) => one.adGroupId === added.id));

title('Puis réparée : le ciblage remis, l’erreur part');
const mended = await proof(async () => {
  await call('PUT', `/targeting-groups/${addedNode.id}/targeting`, { targeting: { country: { include: ['FR'] } } });
});
printUnits(mended.filter((one) => one.adGroupId === added.id));

title('Reste à relever, à la main : les limites d’objets du compte');
say('Sur la page « limites du compte » de Google Ads (Aide Google Ads, « account limits ») : campagnes par');
say('compte, ad groups par campagne, mots-clés, annonces actives. Donne-moi les chiffres (A-FAIRE.md § 5).');

closeTerminal();
console.log('\nTout reste en pause chez Google : la campagne l’est.');
