#!/usr/bin/env node
/**
 * Scenario: the proof of lot 3b (`backend/docs/phase-10.md` § 8.8) — what Google made of the ads of a
 * campaign `campagne-google.mjs` launched, read by the job `review.poll` and shown two ways: on the
 * campaign's platform status, and on the Lines of each creative. It changes nothing.
 *
 * Run from the repository root, the API and a worker running locally — the worker runs `review.poll`,
 * every ten minutes:
 *
 *   node scenarios/campagne-google-verdicts.mjs
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
  say,
  stop,
  title,
  verdictText,
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
console.log(`\nScénario « les verdicts de la campagne Google » contre ${CONFIG.url}`);

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

title('Le verdict de chaque annonce, dans le statut de plateforme de la campagne');
const units = (await call('GET', `/campaigns/${campaign.id}/platform-status`)).units ?? [];
if (units.length === 0) stop('Cette campagne n’a rien chez Google : sa synchro n’a jamais eu lieu.');
const lineIds = new Set();
for (const unit of units) {
  say(
    `${unit.platform}, AdGroup ${unit.adGroupId} — verdicts lus ` +
      (unit.reviewsReadAt ? `le ${unit.reviewsReadAt.slice(0, 16).replace('T', ' à ')} (UTC)` : 'jamais encore')
  );
  for (const object of (unit.objects ?? []).filter((one) => one.level === 'line')) {
    lineIds.add(object.nodeId);
    say(`   annonce ${object.externalId ?? 'pas encore créée'} : ${verdictText(object.review)}`);
  }
}
if (units.every((unit) => !unit.reviewsReadAt)) {
  console.log(
    '\n\x1b[33m⚠ Aucun verdict n’a encore été lu : le job review.poll passe toutes les dix minutes, dans un' +
      ' worker. Dans backend/ :\n  pnpm start:worker\nPuis relance ce scénario.\x1b[0m'
  );
}

title('Les mêmes verdicts, créa par créa');
const creatives = new Set();
for (const lineId of lineIds) {
  const line = await call('GET', `/lines/${lineId}`);
  if (line.creativeId) creatives.add(line.creativeId);
}
for (const creativeId of creatives) {
  const creative = await call('GET', `/creatives/${creativeId}`);
  say(`${creative.name}`);
  for (const line of (await call('GET', `/creatives/${creativeId}/lines?limit=100`)).items) {
    const verdicts = line.reviews.map((review) => `${review.platform} : ${verdictText(review)}`);
    say(`   Line « ${line.name} » — ${verdicts.length > 0 ? verdicts.join(' ; ') : 'verdict pas encore lu'}`);
  }
}

closeTerminal();
console.log(
  '\nCompare avec Google Ads : la campagne, ses annonces, la colonne « État ». Une annonce en pause reste' +
    ' peut-être en examen : si c’est encore le cas demain, Google n’examine pas une annonce en pause.'
);
