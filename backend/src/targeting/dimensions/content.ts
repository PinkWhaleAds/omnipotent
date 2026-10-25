import { z } from 'zod';

import { TargetingDimension } from '@src/types';
import { includeExclude, opaqueIds, range } from '../families';
import { dimension, DimensionDescriptor } from './descriptor';

/** The longest content a duration criterion can name, in seconds: a day. */
const MAX_CONTENT_SECONDS = 86_400;

/** How mature the content around the ad is. */
const contentRatingSchema = z.enum(['general', 'parental_guidance', 'teens', 'mature', 'unrated']);

/** The shapes a video ad takes. */
const videoAdFormatSchema = z.enum(['instream', 'outstream', 'full_episode_player']);

/** How large the player is, as the platforms bucket it. */
const videoPlayerSizeSchema = z.enum(['small', 'large', 'hd', 'unknown']);

/** How the video starts, and with what sound. */
const playbackMethodSchema = z.enum([
  'auto_sound_on',
  'auto_sound_off',
  'click_to_play',
  'mouse_over',
  'entering_viewport',
]);

/** Where on the page the ad sits. */
const positionSchema = z.enum(['above_fold', 'below_fold', 'unknown']);

/** Which full-screen formats are wanted. */
const interstitialParallaxSchema = z.enum(['interstitial', 'parallax']);

/** Around which content, and in which format. */
export const CONTENT_DIMENSIONS = {
  category: dimension('Catégories de contenu', 'opaque_ids', opaqueIds()),
  content_genre: dimension('Genres de contenu', 'opaque_ids', opaqueIds()),
  content_rating: dimension('Classification du contenu', 'include_exclude', includeExclude(contentRatingSchema)),
  content_duration: dimension('Durée du contenu', 'range', range({ min: 0, max: MAX_CONTENT_SECONDS, integer: true })),
  video_ad_format: dimension('Formats vidéo', 'include_exclude', includeExclude(videoAdFormatSchema)),
  video_player_size: dimension('Taille du lecteur', 'include_exclude', includeExclude(videoPlayerSizeSchema)),
  playback_method: dimension('Mode de lecture', 'include_exclude', includeExclude(playbackMethodSchema)),
  skippable_video: dimension(
    'Vidéo désactivable et récompensée',
    'shape',
    z
      .strictObject({ skippable: z.boolean().optional(), rewarded: z.boolean().optional() })
      .refine(
        (criteria): boolean => criteria.skippable !== undefined || criteria.rewarded !== undefined,
        'say at least one of skippable and rewarded, or drop the dimension'
      )
  ),
  position: dimension('Position dans la page', 'include_exclude', includeExclude(positionSchema)),
  social_placement: dimension('Emplacements sociaux', 'opaque_ids', opaqueIds()),
  interstitial_parallax: dimension(
    'Formats plein écran',
    'include_exclude',
    includeExclude(interstitialParallaxSchema)
  ),
  youtube_channel: dimension('Chaînes YouTube', 'opaque_ids', opaqueIds()),
  youtube_video: dimension('Vidéos YouTube', 'opaque_ids', opaqueIds()),
} satisfies Partial<Record<TargetingDimension, DimensionDescriptor>>;
