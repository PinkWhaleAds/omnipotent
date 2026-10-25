import { z } from 'zod';

import { TargetingDimension } from '@src/types';
import { includeExclude, opaqueIds } from '../families';
import { dimension, DimensionDescriptor, listsOf } from './descriptor';

/** ISO 639-1 language code. */
const languageCodeSchema = z.string().regex(/^[a-z]{2}$/, 'A language is an ISO 639-1 code, e.g. fr');

/** A device make, model, or the two joined, as the platform spells it. */
const deviceNameSchema = z.string().trim().min(1).max(120);

/** A hostname, or a single address or block, in either version of the protocol. */
const ipSchema = z.union([z.ipv4(), z.ipv6(), z.cidrv4(), z.cidrv6()]);

/** The kinds of screen an impression can be served on. */
const deviceKindSchema = z.enum([
  'desktop',
  'mobile',
  'tablet',
  'ctv',
  'set_top_box',
  'audio_player',
  'dooh_screen',
  'other',
]);

/** The operating systems the model names; the platform maps them to its own vocabulary. */
const osSchema = z.enum([
  'ios',
  'android',
  'windows',
  'macos',
  'linux',
  'chrome_os',
  'tizen',
  'webos',
  'roku',
  'fire_os',
  'other',
]);

/** The browsers the model names. */
const browserSchema = z.enum(['chrome', 'safari', 'firefox', 'edge', 'opera', 'samsung_internet', 'other']);

/** How the device reaches the network. */
const connectionSchema = z.enum([
  'wifi',
  'ethernet',
  'cellular_2g',
  'cellular_3g',
  'cellular_4g',
  'cellular_5g',
  'unknown',
]);

/** Where the impression is served: the open web, or inside an application. */
const environmentSchema = z.enum(['web', 'app']);

/** On what, and through what: the technical dimensions. */
export const TECHNICAL_DIMENSIONS = {
  device: dimension('Types d’appareil', 'include_exclude', includeExclude(deviceKindSchema)),
  device_make: dimension('Marques d’appareil', 'opaque_ids', opaqueIds()),
  device_model: dimension('Modèles d’appareil', 'opaque_ids', opaqueIds()),
  device_make_model: dimension('Marques et modèles nommés', 'include_exclude', includeExclude(deviceNameSchema)),
  os: dimension('Systèmes d’exploitation', 'include_exclude', includeExclude(osSchema)),
  browser: dimension('Navigateurs', 'include_exclude', includeExclude(browserSchema)),
  carrier: dimension('Opérateurs mobiles', 'opaque_ids', opaqueIds()),
  connection: dimension('Types de connexion', 'include_exclude', includeExclude(connectionSchema)),
  ip: dimension('Adresses et blocs IP', 'include_exclude', includeExclude(ipSchema)),
  language: dimension('Langues', 'include_exclude', includeExclude(languageCodeSchema)),
  environment: dimension('Environnement', 'include_exclude', includeExclude(environmentSchema)),
  device_lists: listsOf('Listes d’appareils', 'device'),
  bundle_lists: listsOf('Listes de bundles d’applications', 'bundle'),
} satisfies Partial<Record<TargetingDimension, DimensionDescriptor>>;
