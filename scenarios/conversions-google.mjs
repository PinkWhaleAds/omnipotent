#!/usr/bin/env node
/**
 * Scenario: the proof of lot 3d (`backend/docs/phase-10.md` § 8.10, D58) — a conversion goal created on
 * the brand of a campaign `campagne-google.mjs` launched, set up on its Google account, its script put
 * on a test page served here, and the AdGroup of the campaign bidding `maximize_conversions` on it.
 *
 * Run from the repository root, the API and a worker running locally — the worker sets the goal up at
 * Google and runs the synchronization:
 *
 *   node scenarios/conversions-google.mjs
 *
 * Lorin's own values go in `config.local.mjs`, which git ignores; whatever is left empty is asked.
 */
import { createServer } from 'node:http';

import {
  ask,
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
  wait,
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
  /** The key of the goal: created if the brand has none of that key. */
  goalKey: 'achat-test',
  /** Where the test page is served. */
  pagePort: 3013,
});

await ensureToken(CONFIG);
const call = createApi(CONFIG);
console.log(`\nScénario « les conversions chez Google » contre ${CONFIG.url}`);

await chooseOrganization(call, CONFIG);
const advertiser = await chooseAdvertiser(call, CONFIG);

title(`L'objectif « ${CONFIG.goalKey} »`);
const goals = (await call('GET', `/advertisers/${advertiser.id}/conversion-goals?limit=200`)).items;
let goal = goals.find((one) => one.key === CONFIG.goalKey);
if (goal) {
  say(`déjà là : ${goal.name} (${goal.status}, ${goal.id})`);
  if (goal.status === 'archived') goal = await call('PATCH', `/conversion-goals/${goal.id}`, { status: 'active' });
} else {
  goal = await call('POST', `/advertisers/${advertiser.id}/conversion-goals`, {
    key: CONFIG.goalKey,
    name: 'Achat (test)',
    category: 'purchase',
    valueMode: 'dynamic',
    defaultValueCents: 5_000,
    currency: 'EUR',
  });
  say(`créé : ${goal.name} (${goal.id}), valeur envoyée par le site, 50 € par défaut`);
}

title('Sa mise en place chez Google');
let tracking;
let google;
for (let waited = 0; waited <= 180; waited += 5) {
  tracking = await call('GET', `/advertisers/${advertiser.id}/tracking`);
  google = tracking.platforms.find((one) => one.platform === 'google_ads');
  const state = google?.goals.find((one) => one.goalId === goal.id);
  if (google && google.status !== 'pending' && state && state.status !== 'pending') break;
  if (waited === 0) say('le worker la fait en tâche de fond : j’attends…');
  await wait(5_000);
}
if (!google) stop('Cette marque n’a pas de compte Google relié.');
say(`suivi du compte ${google.adAccountName ?? google.adAccountId} : ${google.status}${google.messageCode ? ` (${google.messageCode})` : ''}`);
if (google.message) say(`  ${google.message}`);
const state = google.goals.find((one) => one.goalId === goal.id);
say(`objectif : ${state?.status ?? 'pending'}${state?.messageCode ? ` (${state.messageCode})` : ''}`);
if (state?.message) say(`  ${state.message}`);
if (state?.status !== 'ready') {
  stop(
    'L’objectif n’est pas prêt chez Google. Si rien n’a bougé, le worker tourne-t-il ? Dans backend/ : pnpm start:worker'
  );
}

title('Le script, sur une page de test');
const page = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Omnipotent — page de test des conversions</title>
${tracking.snippet}
</head>
<body style="font-family: sans-serif; max-width: 40rem; margin: 3rem auto; line-height: 1.5">
<h1>Page de test des conversions</h1>
<p>Ouvre l'onglet Réseau des outils du navigateur, puis :</p>
<p><button onclick="msq('consent', { ads: 'granted' }); this.textContent = 'Consentement donné';">1. Accepter les cookies publicitaires</button></p>
<p><button onclick="msq('conversion', { goal: '${CONFIG.goalKey}', value: 89.9, currency: 'EUR', orderId: 'test-' + Date.now() }); this.textContent = 'Conversion envoyée';">2. Envoyer une conversion de 89,90 €</button></p>
<p>Avant le consentement, rien ne part. Après, la balise de Google se charge (<code>gtag/js</code>), puis la conversion part vers Google avec le libellé de l'objectif.</p>
</body>
</html>`;
const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(page);
});
await new Promise((resolve) => server.listen(CONFIG.pagePort, resolve));
say(`ouvre http://localhost:${CONFIG.pagePort} dans ton navigateur`);
say(`domaines à autoriser par la CSP d’un vrai site : ${tracking.cspDomains.join(', ')}`);
await ask('\nQuand la conversion est partie (onglet Réseau), appuie sur Entrée pour la suite… ');
server.close();

const after = await call('GET', `/advertisers/${advertiser.id}/tracking`);
say(after.lastSeenAt ? `l’API a vu le script chargé à ${after.lastSeenAt}` : 'l’API n’a pas vu le script chargé');

title('La campagne lancée');
const launched = (await call('GET', `/advertisers/${advertiser.id}/campaigns?limit=100`)).items
  .filter((one) => one.status === 'active' || one.status === 'paused')
  .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
const campaign = CONFIG.campaignId
  ? launched.find((one) => one.id === CONFIG.campaignId)
  : await pick(launched, (one) => `${one.name} (${one.status})`);
if (!campaign) stop('Aucune campagne lancée pour cette marque : joue d’abord scenarios/campagne-google.mjs.');
const lever = (await call('GET', `/campaigns/${campaign.id}/levers`)).items.find((one) => one.lever === 'search');
if (!lever) stop('Cette campagne n’a pas de levier Search.');
const [adGroup] = (await call('GET', `/levers/${lever.id}/ad-groups?limit=100`)).items.sort((left, right) =>
  left.createdAt.localeCompare(right.createdAt)
);
const units = (await call('GET', `/campaigns/${campaign.id}/platform-status`)).units ?? [];
const accountId = units[0]?.adAccountId;
say(`${campaign.name} — AdGroup « ${adGroup.name} », aujourd’hui en ${adGroup.bidStrategy}`);

const since = new Date().toISOString();
title('L’AdGroup en maximize_conversions, sur cet objectif');
await call('PATCH', `/ad-groups/${adGroup.id}`, { bidStrategy: 'maximize_conversions', conversionGoalId: goal.id });
say('fait');

title('La preview');
const preview = await call('GET', `/campaigns/${campaign.id}/preview`);
const findings = [...preview.errors, ...preview.warnings].filter((finding) =>
  /conversion|bid_amount/.test(finding.code)
);
say(
  findings.length === 0
    ? '\x1b[32mRien à redire de l’objectif.\x1b[0m'
    : findings.map((finding) => `${finding.code} ${JSON.stringify(finding.params)}`).join('\n')
);

title('La synchro');
const synced = await settled(call, campaign.id);
printUnits(synced);
if (accountId) {
  printCalls(
    (await call('GET', `/ad-accounts/${accountId}/platform-calls?since=${encodeURIComponent(since)}&limit=200`)).items
  );
}

const nodes = (await call('GET', `/ad-groups/${adGroup.id}/targeting-groups?limit=100`)).items;
const campaigns = synced
  .flatMap((unit) => unit.objects ?? [])
  .filter((object) => nodes.some((node) => object.key === `targeting_group:${node.id}`))
  .map((object) => object.externalId?.split('/').pop())
  .filter(Boolean);
console.log(
  '\nÀ vérifier dans Google Ads :\n' +
    `  - Objectifs, Conversions : l’action « ${advertiser.name} — ${goal.name} », en action secondaire ;\n` +
    `  - la campagne ${campaigns.join(', ') || '(pas encore créée)'}, Paramètres : enchères « Maximiser les conversions »,\n` +
    '    et dans ses objectifs, l’objectif personnalisé du même nom seul.'
);
closeTerminal();
