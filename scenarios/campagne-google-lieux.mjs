#!/usr/bin/env node
/**
 * Scenario: the proof of lot 3c (`backend/docs/phase-10.md` § 8.9) — the TargetingGroup of a campaign
 * `campagne-google.mjs` launched, targeted on a city and a postal code found in the referential of
 * places, its circle written again with its country (D57), and what reached Google: France replaced by
 * them, never added to them.
 *
 * Run from the repository root, the API and a worker running locally — the worker imports the
 * referential at its start when it is empty, and runs the synchronization:
 *
 *   node scenarios/campagne-google-lieux.mjs
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
  /** The country of the places, which they replace at Google. */
  country: 'FR',
  /** The city to target, searched in the referential. */
  city: 'Paris',
  /** The postal code to target, searched in the referential. */
  postalCode: '75001',
});

await ensureToken(CONFIG);
const call = createApi(CONFIG);
console.log(`\nScénario « les lieux de la campagne Google » contre ${CONFIG.url}`);

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
const units = (await call('GET', `/campaigns/${campaign.id}/platform-status`)).units ?? [];
if (units.length === 0) stop('Cette campagne n’a rien chez Google : sa synchro n’a jamais eu lieu.');
const accountId = units[0].adAccountId;
say(`AdGroup « ${adGroup.name} », ciblage « ${node.name} »`);

/**
 * The first place the referential finds for a text, at one level.
 *
 * @param {string} text - What is searched
 * @param {string} level - Its level
 * @returns {Promise<object>} The place
 */
async function placeOf(text, level) {
  const query = `q=${encodeURIComponent(text)}&countries=${CONFIG.country}&levels=${level}&limit=5`;
  const { items } = await call('GET', `/geo/locations?${query}`);
  if (items.length === 0) {
    stop(
      `Le référentiel ne trouve pas « ${text} » (${level}). S’il est vide, le worker l’importe à son démarrage :` +
        ' relance-le, attends une minute, puis relance ce scénario.'
    );
  }
  for (const one of items) say(`${one.id === items[0].id ? '→' : ' '} ${one.name} — ${one.canonicalName} (${one.id})`);
  return items[0];
}

title(`Le référentiel des lieux : « ${CONFIG.city} » et « ${CONFIG.postalCode} »`);
const city = await placeOf(CONFIG.city, 'city');
const postalCode = await placeOf(CONFIG.postalCode, 'postal_code');

title('Le ciblage avant');
const before = (await call('GET', `/targeting-groups/${node.id}/targeting`)).targeting;
say(JSON.stringify(before));

const since = new Date().toISOString();

title(`Le rayon, réenregistré avec son pays (${CONFIG.country})`);
const points = (before.proximity?.points ?? []).map((point) => ({ ...point, countryCode: point.countryCode ?? CONFIG.country }));
if (points.length > 0) {
  await call('PUT', `/targeting-groups/${node.id}/targeting/proximity`, { criteria: { points } });
  for (const point of points) say(`${point.label ?? `${point.latitude}, ${point.longitude}`}, ${point.radiusKm} km, ${point.countryCode}`);
} else {
  say('Aucun rayon : rien à réenregistrer.');
}

title('La ville et le code postal, par leur seul identifiant');
const after = await call('PUT', `/targeting-groups/${node.id}/targeting/location`, {
  criteria: { include: [{ id: city.id }, { id: postalCode.id }] },
});
for (const place of after.targeting.location.include) {
  say(`${place.name} — ${place.level}, ${place.countryCode} — complété par l’API depuis le référentiel`);
}

title('La preview');
const preview = await call('GET', `/campaigns/${campaign.id}/preview`);
const geo = [...preview.errors, ...preview.warnings].filter((finding) => finding.code.startsWith('preview_geo'));
say(geo.length === 0 ? '\x1b[32mRien à redire des lieux.\x1b[0m' : geo.map((finding) => `${finding.code} ${JSON.stringify(finding.params)}`).join('\n'));

title('La synchro');
const synced = await settled(call, campaign.id);
printUnits(synced);
printCalls(
  (await call('GET', `/ad-accounts/${accountId}/platform-calls?since=${encodeURIComponent(since)}&limit=200`)).items
);

// One Google campaign per TargetingGroup: the one to open is this TargetingGroup's, not the others'.
const googleCampaign = synced
  .flatMap((unit) => unit.objects ?? [])
  .find((object) => object.key === `targeting_group:${node.id}`)
  ?.externalId?.split('/')
  .pop();
console.log(
  `\nÀ vérifier dans Google Ads : la campagne ${googleCampaign ?? '(pas encore créée)'}, celle du ciblage ` +
    `« ${node.name} » — Paramètres, Zones géographiques. On doit y lire ` +
    `${city.name}, ${postalCode.name}${points.length > 0 ? ' et le rayon' : ''} — et plus la France entière.`
);
closeTerminal();
