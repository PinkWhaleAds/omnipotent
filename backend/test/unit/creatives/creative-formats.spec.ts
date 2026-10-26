import {
  allCouples,
  assertRoles,
  CREATIVE_FORMATS,
  creativeCatalog,
  declaredDiscriminants,
  parsePayload,
  rulesOfCouple,
  SEARCH_AD_LIMITS,
} from '@src/creatives/creative-formats';
import { AssetRole, CreativeFormat, CreativeFormatDescriptor, CreativeSubtype } from '@src/types';

/** One payload a couple accepts, and one it refuses — « une forme voisine ». */
type Example = { valid: unknown; invalid: unknown };

/** Three headlines and two descriptions: the least a responsive search ad holds. */
const RSA = {
  headlines: ['Chaussures de rando', 'Livraison offerte', 'Garantie deux ans'],
  descriptions: ['Des chaussures pour tous les terrains.', 'Essayez-les un mois.'],
};

/** What each couple accepts, and what it does not. */
const EXAMPLES: Record<string, Example> = {
  'search_text:rsa': { valid: RSA, invalid: { ...RSA, headlines: RSA.headlines.slice(0, 2) } },
  'display:image': { valid: { altText: 'Bannière' }, invalid: { altText: '' } },
  'display:mraid': { valid: { entryFile: 'index.html' }, invalid: {} },
  'video:file': { valid: {}, invalid: { vastUrl: 'https://vast.test/tag.xml' } },
  'video:vast_url': { valid: { vastUrl: 'https://vast.test/tag.xml' }, invalid: { vastUrl: 'http://vast.test' } },
  'video:youtube_id': { valid: { youtubeVideoId: 'dQw4w9WgXcQ' }, invalid: { youtubeVideoId: 'tooshort' } },
  'audio:file': { valid: {}, invalid: { title: 'Spot' } },
  'audio:vast_url': { valid: { vastUrl: 'https://daast.test/tag.xml' }, invalid: {} },
  'native:assets': { valid: { title: 'Herbéa' }, invalid: { body: 'Sans titre' } },
};

describe('Unit::Creatives::CreativeFormats', () => {
  describe('the registry', () => {
    it('should declare the couples of the framing, and only those', (): void => {
      // The table of `../../CADRAGE.md` § 9, minus the two subtypes no platform of our references
      // accepts (L20), plus the YouTube identifier the Demand Gen path of DV360 takes.
      expect(Object.keys(CREATIVE_FORMATS).sort()).toEqual([
        'audio:file',
        'audio:vast_url',
        'display:image',
        'display:mraid',
        'native:assets',
        'search_text:rsa',
        'video:file',
        'video:vast_url',
        'video:youtube_id',
      ]);
    });

    it('should leave html5 and script_tag out of the subtypes a creative can take', (): void => {
      const { subtypes }: { subtypes: CreativeSubtype[] } = declaredDiscriminants();

      expect(subtypes).not.toContain('html5');
      expect(subtypes).not.toContain('script_tag');
    });

    it('should use every format and every subtype of the enumerations', (): void => {
      // A subtype nobody couples is a subtype nobody can send: the two lists must agree.
      const { formats, subtypes } = declaredDiscriminants();
      const used: { format: CreativeFormat; subtype: CreativeSubtype }[] = allCouples();

      for (const format of formats) {
        expect({ format, used: used.some((couple): boolean => couple.format === format) }).toEqual({
          format,
          used: true,
        });
      }
      for (const subtype of subtypes) {
        expect({ subtype, used: used.some((couple): boolean => couple.subtype === subtype) }).toEqual({
          subtype,
          used: true,
        });
      }
    });

    it('should give every couple a label and roles', (): void => {
      for (const { format, subtype } of allCouples()) {
        const rules = rulesOfCouple(format, subtype);

        expect({ format, subtype, label: rules.label.length > 0 }).toEqual({ format, subtype, label: true });
        expect(Array.isArray(rules.requiredRoles)).toBe(true);
      }
    });

    it('should refuse a couple it does not know, naming both discriminants', (): void => {
      expect((): unknown => rulesOfCouple('display', 'rsa')).toThrow(
        expect.objectContaining({
          statusCode: 400,
          errorCode: 'creative_couple_unknown',
          errorParams: { format: 'display', subtype: 'rsa' },
        })
      );
    });
  });

  describe('the payload of each couple', () => {
    it.each(Object.entries(EXAMPLES))(
      'should say what %s accepts, and what it does not',
      (key: string, example: Example): void => {
        const [format, subtype] = key.split(':') as [CreativeFormat, CreativeSubtype];

        expect({ key, parsed: parsePayload(format, subtype, example.valid) }).toEqual({
          key,
          parsed: expect.any(Object),
        });
        expect((): unknown => parsePayload(format, subtype, example.invalid)).toThrow(
          expect.objectContaining({
            errorCode: 'creative_payload_invalid',
            errorParams: { format, subtype, reason: expect.any(String) },
          })
        );
      }
    );

    it('should carry an example for every couple of the registry', (): void => {
      expect(
        allCouples()
          .map(({ format, subtype }): string => `${format}:${subtype}`)
          .filter((key: string): boolean => EXAMPLES[key] === undefined)
      ).toEqual([]);
    });

    it('should apply the defaults of a payload, so a read never guesses', (): void => {
      expect(parsePayload('search_text', 'rsa', RSA)).toEqual({ ...RSA, displayPaths: [] });
    });

    it('should hold a search ad to the limits of its platforms', (): void => {
      const headlines: string[] = Array.from({ length: SEARCH_AD_LIMITS.maxHeadlines + 1 }, (): string => 'Titre');

      expect((): unknown => parsePayload('search_text', 'rsa', { ...RSA, headlines })).toThrow(
        expect.objectContaining({ errorCode: 'creative_payload_invalid' })
      );
      expect((): unknown =>
        parsePayload('search_text', 'rsa', { ...RSA, headlines: ['x'.repeat(SEARCH_AD_LIMITS.headlineLength + 1)] })
      ).toThrow(expect.objectContaining({ errorCode: 'creative_payload_invalid' }));
    });

    it('should refuse a key the payload does not declare, rather than dropping it', (): void => {
      expect((): unknown => parsePayload('display', 'image', { altText: 'Bannière', width: 300 })).toThrow(
        expect.objectContaining({ errorCode: 'creative_payload_invalid' })
      );
    });
  });

  describe('assertRoles', () => {
    it('should accept exactly the roles a couple expects', (): void => {
      expect((): void => assertRoles('display', 'image', ['image'])).not.toThrow();
      expect((): void => assertRoles('display', 'image', ['image', 'logo'])).not.toThrow();
      expect((): void => assertRoles('video', 'youtube_id', [])).not.toThrow();
    });

    it('should refuse a missing role, naming it', (): void => {
      // Hawk refuses a redirected VAST without a poster (G5), so the model asks for it.
      expect((): void => assertRoles('video', 'vast_url', [])).toThrow(
        expect.objectContaining({
          statusCode: 400,
          errorCode: 'creative_asset_role_missing',
          errorParams: { role: 'thumbnail', format: 'video', subtype: 'vast_url' },
        })
      );
    });

    it('should refuse a role the couple has nothing to do with', (): void => {
      expect((): void => assertRoles('display', 'image', ['image', 'video'])).toThrow(
        expect.objectContaining({
          statusCode: 400,
          errorCode: 'creative_asset_role_unknown',
          errorParams: { role: 'video', format: 'display', subtype: 'image' },
        })
      );
    });

    it('should name only the roles of the enumeration', (): void => {
      for (const { format, subtype } of allCouples()) {
        const rules = rulesOfCouple(format, subtype);
        for (const role of [...rules.requiredRoles, ...rules.optionalRoles] as AssetRole[]) {
          expect(['image', 'video', 'audio', 'bundle', 'thumbnail', 'logo', 'icon']).toContain(role);
        }
      }
    });
  });

  describe('creativeCatalog', () => {
    it('should answer one descriptor per couple, with the JSON schema of its payload', (): void => {
      const catalog: CreativeFormatDescriptor[] = creativeCatalog();

      expect(catalog).toHaveLength(allCouples().length);
      expect(catalog.find((entry): boolean => entry.format === 'video' && entry.subtype === 'vast_url')).toEqual(
        expect.objectContaining({ requiredRoles: ['thumbnail'], payloadSchema: expect.any(Object) })
      );
    });
  });
});
