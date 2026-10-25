import {
  allDimensions,
  descriptorOf,
  DimensionDescriptor,
  dimensionCatalog,
  listKindOf,
  parseCriteria,
  parseTargeting,
  TARGETING_DIMENSIONS,
  targetingObjectSchema,
} from '@src/targeting/dimensions';
import { TargetingDimension, targetingDimensionSchema, TargetingDimensionDescriptor } from '@src/types';

/** An id of a list, for the dimensions that reference one. */
const LIST_ID = '11111111-1111-4111-8111-111111111111';

/**
 * One example a dimension accepts, and one it refuses — « une forme voisine », so the test says what
 * the vocabulary is rather than that something was validated (`docs/phase-5.md` § 9).
 */
type Example = { valid: unknown; invalid: unknown };

/** The dimensions whose vocabulary or whose shape is their own, each with its two examples. */
const EXAMPLES: Partial<Record<TargetingDimension, Example>> = {
  country: { valid: { include: ['FR', 'BE'] }, invalid: { include: ['fr'] } },
  zip_code: { valid: { include: ['75011'] }, invalid: { include: [''] } },
  language: { valid: { include: ['fr'] }, invalid: { include: ['FR'] } },
  device: { valid: { include: ['dooh_screen'] }, invalid: { include: ['screen'] } },
  device_make_model: { valid: { include: ['apple iphone 15'] }, invalid: { include: [42] } },
  os: { valid: { include: ['ios', 'android'] }, invalid: { include: ['iOS'] } },
  browser: { valid: { include: ['chrome'] }, invalid: { include: ['Chrome'] } },
  connection: { valid: { exclude: ['cellular_2g'] }, invalid: { exclude: ['2g'] } },
  environment: { valid: { include: ['app'] }, invalid: { include: ['site'] } },
  ip: { valid: { exclude: ['192.168.0.0/24', '2001:db8::1'] }, invalid: { exclude: ['192.168.0'] } },
  domain: { valid: { exclude: ['Example.COM'] }, invalid: { exclude: ['exemple com'] } },
  content_rating: { valid: { exclude: ['mature'] }, invalid: { exclude: ['adult'] } },
  video_ad_format: { valid: { include: ['instream'] }, invalid: { include: ['inStream'] } },
  video_player_size: { valid: { include: ['hd'] }, invalid: { include: ['medium'] } },
  playback_method: { valid: { include: ['auto_sound_off'] }, invalid: { include: ['muted'] } },
  position: { valid: { include: ['above_fold'] }, invalid: { include: ['top'] } },
  interstitial_parallax: { valid: { include: ['parallax'] }, invalid: { include: ['both'] } },
  demographics: { valid: { ageRanges: ['25_34'], genders: ['female'] }, invalid: { ageRanges: ['25-34'] } },
  proximity: { valid: { points: [{ latitude: 48.86, longitude: 2.35, radiusKm: 5 }] }, invalid: { points: [] } },
  gps: {
    valid: { shapes: [{ kind: 'circle', label: 'Bastille', latitude: 48.85, longitude: 2.37, radiusKm: 1.5 }] },
    invalid: { shapes: [{ kind: 'circle', label: 'Bastille', latitude: 148.85, longitude: 2.37, radiusKm: 1.5 }] },
  },
  poi: { valid: { categories: ['LOI_42'], radiusKm: 2 }, invalid: { categories: ['LOI_42'], radiusKm: 0 } },
  skippable_video: { valid: { skippable: true }, invalid: {} },
  brand_suitability: { valid: { level: 'limited' }, invalid: { level: 'strict' } },
  verifier: { valid: { provider: 'ias', categories: ['adult'] }, invalid: { provider: 'ias', categories: [] } },
  schedule: {
    valid: { windows: [{ day: 'saturday', startHour: 10, endHour: 22 }], clock: 'user' },
    invalid: { windows: [{ day: 'saturday', startHour: 10, endHour: 22 }], clock: 'advertiser' },
  },
  context_hints: { valid: { hints: ['randonnée', 'vélo'] }, invalid: { hints: [] } },
  key_value: {
    valid: { pairs: [{ key: 'section', values: ['sport'] }] },
    invalid: { pairs: [{ key: 'section', values: [] }] },
  },
  product: { valid: { include: [{ id: 'B0001', match: 'similar' }] }, invalid: { include: [{ id: 'B0001' }] } },
  multiplier: { valid: { min: 1, max: 3 }, invalid: { min: 0 } },
  viewability: { valid: { min: 70 }, invalid: { min: 0 } },
  content_duration: { valid: { min: 0, max: 30 }, invalid: { min: -1 } },
  ifa_sampling: { valid: { max: 50 }, invalid: { max: 101 } },
};

describe('Unit::Targeting::Dimensions', () => {
  describe('the registry', () => {
    it('should declare every dimension of the enumeration, and nothing else', (): void => {
      expect(allDimensions().sort()).toEqual([...targetingDimensionSchema.options].sort());
      expect(Object.keys(TARGETING_DIMENSIONS)).toHaveLength(targetingDimensionSchema.options.length);
    });

    it('should give every dimension a label and a family', (): void => {
      for (const dimension of allDimensions()) {
        const descriptor: DimensionDescriptor = descriptorOf(dimension);

        expect({ dimension, label: descriptor.label.length > 0 }).toEqual({ dimension, label: true });
        expect(descriptor.family).toEqual(expect.any(String));
      }
    });

    it('should give a kind of list to every dimension that references lists, and to no other', (): void => {
      for (const dimension of allDimensions()) {
        const expected: boolean = descriptorOf(dimension).family === 'list_reference';

        expect({ dimension, hasKind: listKindOf(dimension) !== null }).toEqual({ dimension, hasKind: expected });
      }
    });
  });

  describe('what the families guarantee, dimension by dimension', (): void => {
    it('should refuse a criterion that restricts nothing, whatever the dimension', (): void => {
      for (const dimension of allDimensions()) {
        expect({ dimension, accepted: descriptorOf(dimension).schema.safeParse({}).success }).toEqual({
          dimension,
          accepted: false,
        });
      }
    });

    it('should take an opaque identifier on every dimension that names a referential', (): void => {
      for (const dimension of allDimensions()) {
        if (descriptorOf(dimension).family !== 'opaque_ids') continue;

        expect({ dimension, parsed: parseCriteria(dimension, { include: ['x_1'] }) }).toEqual({
          dimension,
          parsed: { include: ['x_1'], exclude: [] },
        });
        expect(descriptorOf(dimension).schema.safeParse({ include: [''] }).success).toBe(false);
      }
    });

    it('should take list ids on every dimension that references lists', (): void => {
      for (const dimension of allDimensions()) {
        if (descriptorOf(dimension).family !== 'list_reference') continue;

        expect({ dimension, parsed: parseCriteria(dimension, { include: [LIST_ID] }) }).toEqual({
          dimension,
          parsed: { include: [LIST_ID], exclude: [] },
        });
        expect(descriptorOf(dimension).schema.safeParse({ include: ['nope'] }).success).toBe(false);
      }
    });
  });

  describe('the vocabulary of each dimension', () => {
    it.each(Object.entries(EXAMPLES))(
      'should say what %s accepts, and what it does not',
      (dimension: string, example: Example | undefined): void => {
        const schema = descriptorOf(dimension as TargetingDimension).schema;

        expect({ dimension, accepted: schema.safeParse((example as Example).valid).success }).toEqual({
          dimension,
          accepted: true,
        });
        expect({ dimension, refused: schema.safeParse((example as Example).invalid).success }).toEqual({
          dimension,
          refused: false,
        });
      }
    );

    it('should carry an example for every dimension whose vocabulary or shape is its own', (): void => {
      const own: TargetingDimension[] = allDimensions().filter(
        (dimension: TargetingDimension): boolean =>
          !['opaque_ids', 'list_reference'].includes(descriptorOf(dimension).family)
      );

      expect(own.filter((dimension: TargetingDimension): boolean => EXAMPLES[dimension] === undefined)).toEqual([]);
    });
  });

  describe('parseCriteria', () => {
    it('should apply the defaults of the dimension, so a read never guesses', (): void => {
      expect(parseCriteria('country', { include: ['FR'] })).toEqual({ include: ['FR'], exclude: [] });
      expect(parseCriteria('schedule', { windows: [{ day: 'monday', startHour: 0, endHour: 24 }] })).toEqual({
        windows: [{ day: 'monday', startHour: 0, endHour: 24 }],
        clock: 'campaign',
      });
    });

    it('should refuse criteria that do not hold, naming the dimension and the reason', (): void => {
      expect((): unknown => parseCriteria('country', { include: ['France'] })).toThrow(
        expect.objectContaining({
          statusCode: 400,
          errorCode: 'targeting_criteria_invalid',
          errorParams: expect.objectContaining({ dimension: 'country' }),
        })
      );
    });

    it('should refuse a key the dimension does not declare, rather than dropping it', (): void => {
      expect((): unknown => parseCriteria('country', { include: ['FR'], radiusKm: 2 })).toThrow(
        expect.objectContaining({ errorCode: 'targeting_criteria_invalid' })
      );
    });
  });

  describe('the whole object', () => {
    it('should accept several dimensions at once, and apply their defaults', (): void => {
      expect(parseTargeting({ country: { include: ['FR'] }, device: { include: ['mobile'] } })).toEqual({
        country: { include: ['FR'], exclude: [] },
        device: { include: ['mobile'], exclude: [] },
      });
    });

    it('should name the dimension that does not hold', (): void => {
      expect((): unknown => parseTargeting({ country: { include: ['FR'] }, device: { include: ['fridge'] } })).toThrow(
        expect.objectContaining({ errorParams: expect.objectContaining({ dimension: 'device' }) })
      );
    });

    it('should refuse a dimension the registry does not declare', (): void => {
      expect(targetingObjectSchema.safeParse({ astrology: { include: ['leo'] } }).success).toBe(false);
      expect(targetingObjectSchema.safeParse({ country: { include: ['FR'] } }).success).toBe(true);
      expect(targetingObjectSchema.safeParse({}).success).toBe(true);
    });
  });

  describe('dimensionCatalog', () => {
    it('should answer one descriptor per dimension, with the JSON schema of its criteria', (): void => {
      const catalog: TargetingDimensionDescriptor[] = dimensionCatalog();

      expect(catalog).toHaveLength(targetingDimensionSchema.options.length);
      for (const descriptor of catalog) {
        expect({ dimension: descriptor.dimension, schema: typeof descriptor.criteriaSchema }).toEqual({
          dimension: descriptor.dimension,
          schema: 'object',
        });
      }
      expect(catalog.find((entry: TargetingDimensionDescriptor): boolean => entry.dimension === 'poi_lists')).toEqual(
        expect.objectContaining({ family: 'list_reference', listKind: 'poi' })
      );
    });
  });
});
