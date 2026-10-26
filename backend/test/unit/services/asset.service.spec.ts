import { FastifyInstance } from 'fastify';

import { AssetEntity } from '@src/database/entities';
import AssetServicePlugin, { AssetService, UploadedAsset } from '@src/services/asset.service';
import { Asset, LabelSummary, ListAssetsQuery, Paginated } from '@src/types';
import { AccessServiceMock, buildServiceApp, createAccessMock } from '@test/unit/mocks/access.mock';
import { IDS, JANE, NOW } from '@test/unit/mocks/auth.fixtures';
import { createDataSourceMock, DataSourceMock, QueryBuilderMock } from '@test/unit/mocks/data-source.mock';
import { httpError } from '@utils';

/** The asset and the Advertiser the specs work with. */
const ASSET_ID = 'fc000000-0000-4000-8000-000000000001';
const ADVERTISER_ID = IDS.advertiser;

/** A Label an asset carries. */
const SPRING: LabelSummary = { id: 'e0000000-0000-4000-8000-000000000001', name: 'Printemps', color: '#1f6feb' };

/** The query a list route hands the service when the caller asked for nothing in particular. */
const DEFAULT_QUERY: ListAssetsQuery = {
  page: 1,
  limit: 50,
  sortBy: 'createdAt',
  sortOrder: 'asc',
  includeDeleted: false,
  labelMode: 'any',
};

/**
 * The header of a PNG, which is all an inspector reads to know its size.
 *
 * Written by hand rather than fixtured: a test that posts real bytes proves the inspection, and a
 * file of a few dozen bytes is easier to reason about than a binary in the repository.
 *
 * @param width - Pixels
 * @param height - Pixels
 * @returns The bytes
 */
function png(width: number, height: number): Buffer {
  const ihdr: Buffer = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4);
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8;
  ihdr[17] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr]);
}

/**
 * The header of a JPEG, which is all an inspector reads to know its size.
 *
 * @param width - Pixels
 * @param height - Pixels
 * @returns The bytes
 */
function jpeg(width: number, height: number): Buffer {
  // Start of image, the JFIF application segment an inspector looks for, then the frame header that
  // carries the size.
  const header: number[] = [
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
    0x00, 0xff, 0xc0, 0x00, 0x11, 0x08,
  ];
  const frame: number[] = [0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  return Buffer.from([...header, height >> 8, height & 0xff, width >> 8, width & 0xff, ...frame]);
}

/**
 * An asset row.
 *
 * @param overrides - Columns to change
 * @returns The row
 */
function row(overrides: Partial<AssetEntity> = {}): AssetEntity {
  return {
    id: ASSET_ID,
    organizationId: IDS.organization,
    advertiserId: ADVERTISER_ID,
    fileName: 'banniere.png',
    kind: 'image',
    mimeType: 'image/png',
    sizeBytes: 33,
    width: 300,
    height: 250,
    durationMs: null,
    fingerprint: 'a'.repeat(64),
    provenance: 'uploaded',
    aiGenerationId: null,
    storageKey: `${IDS.organization}/${ADVERTISER_ID}/${ASSET_ID}/banniere.png`,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  } as unknown as AssetEntity;
}

describe('Unit::Services::AssetService', () => {
  let db: DataSourceMock;
  let access: AccessServiceMock;
  let labels: { setOn: jest.Mock; summariesOf: jest.Mock };
  let storage: { put: jest.Mock; downloadUrl: jest.Mock };
  let service: AssetService;

  beforeEach((): void => {
    jest.clearAllMocks();
    db = createDataSourceMock();
    access = createAccessMock();
    labels = { setOn: jest.fn().mockResolvedValue([SPRING]), summariesOf: jest.fn().mockResolvedValue(new Map()) };
    storage = { put: jest.fn().mockResolvedValue(undefined), downloadUrl: jest.fn().mockResolvedValue('https://d/1') };
    service = new AssetService(
      db.dataSource,
      access as never,
      labels as never,
      storage as never,
      {
        maxUploadBytes: 1_000,
      } as never
    );
    db.manager.save.mockImplementation(async (_entity: unknown, saved: object): Promise<object> =>
      Promise.resolve({ createdAt: NOW, updatedAt: NOW, deletedAt: null, ...saved })
    );
  });

  describe('list', () => {
    it('should answer the live assets of the Advertiser, with their download URL', async (): Promise<void> => {
      const builder: QueryBuilderMock = db.builder('asset');
      builder.getManyAndCount.mockResolvedValue([[row()], 1]);

      const page: Paginated<Asset> = await service.list(JANE, IDS.organization, ADVERTISER_ID, DEFAULT_QUERY);

      expect(page.items[0]).toMatchObject({ id: ASSET_ID, kind: 'image', downloadUrl: 'https://d/1' });
      expect(builder.andWhere).toHaveBeenCalledWith('asset.advertiser_id = :advertiserId', {
        advertiserId: ADVERTISER_ID,
      });
      expect(builder.andWhere).toHaveBeenCalledWith('asset.deleted_at IS NULL');
      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'viewer');
    });

    it('should filter on the kind and on the name, and list the deleted ones when asked', async (): Promise<void> => {
      const builder: QueryBuilderMock = db.builder('asset');

      await service.list(JANE, IDS.organization, ADVERTISER_ID, {
        ...DEFAULT_QUERY,
        kind: 'video',
        search: 'Été',
        includeDeleted: true,
      });

      expect(builder.andWhere).toHaveBeenCalledWith('asset.kind = :kind', { kind: 'video' });
      expect(builder.andWhere).toHaveBeenCalledWith(expect.stringContaining('ILIKE'), { search: '%Ete%' });
      expect(builder.andWhere).not.toHaveBeenCalledWith('asset.deleted_at IS NULL');
    });
  });

  describe('get', () => {
    it('should answer an asset, deleted or not', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row({ deletedAt: NOW }));

      await expect(service.get(JANE, IDS.organization, ASSET_ID)).resolves.toMatchObject({
        id: ASSET_ID,
        deletedAt: NOW.toISOString(),
      });
      expect(db.manager.findOne).toHaveBeenCalledWith(AssetEntity, {
        where: { id: ASSET_ID, organizationId: IDS.organization },
        withDeleted: true,
      });
    });

    it('should not find an asset of another Organization', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(null);

      await expect(service.get(JANE, IDS.organization, ASSET_ID)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'asset_not_found',
      });
    });
  });

  describe('upload', () => {
    it('should store the bytes, read the image, and answer a created asset', async (): Promise<void> => {
      const data: Buffer = png(300, 250);

      const uploaded: UploadedAsset = await service.upload(JANE, IDS.organization, ADVERTISER_ID, {
        fileName: 'bannière été.png',
        mimeType: 'image/png',
        data,
      });

      expect(uploaded.created).toBe(true);
      expect(uploaded.asset).toMatchObject({ kind: 'image', mimeType: 'image/png', width: 300, height: 250 });
      // The key is organization, advertiser, asset, safe name — and the name is made safe.
      expect(storage.put).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`^${IDS.organization}/${ADVERTISER_ID}/[0-9a-f-]+/banni_re__t_.png$`)),
        data,
        'image/png'
      );
      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'manager');
    });

    it('should answer the asset already there for the same bytes, storing nothing', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row());

      const uploaded: UploadedAsset = await service.upload(JANE, IDS.organization, ADVERTISER_ID, {
        fileName: 'banniere.png',
        mimeType: 'image/png',
        data: png(300, 250),
      });

      expect(uploaded).toEqual({ asset: expect.objectContaining({ id: ASSET_ID }), created: false });
      expect(storage.put).not.toHaveBeenCalled();
      expect(db.manager.save).not.toHaveBeenCalled();
    });

    it('should post the labels the upload named', async (): Promise<void> => {
      const uploaded: UploadedAsset = await service.upload(JANE, IDS.organization, ADVERTISER_ID, {
        fileName: 'banniere.png',
        mimeType: 'image/png',
        data: png(1, 1),
        labelIds: [SPRING.id],
      });

      expect(labels.setOn).toHaveBeenCalledWith(db.manager, IDS.organization, 'asset', expect.any(String), [SPRING.id]);
      expect(uploaded.asset.labels).toEqual([SPRING]);
    });

    it('should take a video as declared, keeping the duration the caller sent', async (): Promise<void> => {
      const uploaded: UploadedAsset = await service.upload(JANE, IDS.organization, ADVERTISER_ID, {
        fileName: 'spot.mp4',
        mimeType: 'video/mp4',
        data: Buffer.from('not really a video'),
        durationMs: 15_000,
      });

      expect(uploaded.asset).toMatchObject({ kind: 'video', durationMs: 15_000, width: null, height: null });
    });

    it('should refuse a file over the limit', async (): Promise<void> => {
      await expect(
        service.upload(JANE, IDS.organization, ADVERTISER_ID, {
          fileName: 'gros.mp4',
          mimeType: 'video/mp4',
          data: Buffer.alloc(1_001),
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'asset_too_large',
        errorParams: { maxBytes: 1_000, sizeBytes: 1_001 },
      });
    });

    it('should name a JPEG by its MIME type, not by the extension its header says', async (): Promise<void> => {
      const uploaded: UploadedAsset = await service.upload(JANE, IDS.organization, ADVERTISER_ID, {
        fileName: 'photo.jpg',
        mimeType: 'image/jpeg',
        data: jpeg(640, 480),
      });

      expect(uploaded.asset).toMatchObject({ mimeType: 'image/jpeg', width: 640, height: 480 });
    });

    it('should refuse a part that carries no type at all', async (): Promise<void> => {
      await expect(
        service.upload(JANE, IDS.organization, ADVERTISER_ID, {
          fileName: 'mystere',
          mimeType: '',
          data: Buffer.from('?'),
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'asset_type_unsupported',
        errorParams: { mimeType: '' },
      });
    });

    it('should refuse a type the library does not accept', async (): Promise<void> => {
      await expect(
        service.upload(JANE, IDS.organization, ADVERTISER_ID, {
          fileName: 'doc.pdf',
          mimeType: 'application/pdf',
          data: Buffer.from('%PDF'),
        })
      ).rejects.toMatchObject({ statusCode: 400, errorCode: 'asset_type_unsupported' });
    });

    it('should refuse bytes that do not read as the image they claim to be', async (): Promise<void> => {
      await expect(
        service.upload(JANE, IDS.organization, ADVERTISER_ID, {
          fileName: 'faux.png',
          mimeType: 'image/png',
          data: Buffer.from('this is not a png'),
        })
      ).rejects.toMatchObject({ statusCode: 400, errorCode: 'asset_unreadable' });
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('should refuse an image of a type the library does not take, however readable', async (): Promise<void> => {
      // A BMP reads fine and is not in the accepted list: the inspection refuses it rather than
      // storing something no couple can use.
      const bmp: Buffer = Buffer.concat([Buffer.from('BM'), Buffer.alloc(24)]);
      bmp.writeUInt32LE(300, 18);
      bmp.writeUInt32LE(250, 22);

      await expect(
        service.upload(JANE, IDS.organization, ADVERTISER_ID, {
          fileName: 'image.png',
          mimeType: 'image/png',
          data: bmp,
        })
      ).rejects.toMatchObject({ statusCode: 400, errorCode: 'asset_unreadable' });
    });
  });

  describe('update', () => {
    it('should rename an asset', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row());

      const renamed: Asset = await service.update(JANE, IDS.organization, ASSET_ID, { fileName: 'automne.png' });

      expect(db.manager.update).toHaveBeenCalledWith(AssetEntity, { id: ASSET_ID }, { fileName: 'automne.png' });
      expect(renamed.fileName).toBe('automne.png');
    });

    it('should touch nothing when the body changes nothing', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row());

      await expect(service.update(JANE, IDS.organization, ASSET_ID, {})).resolves.toMatchObject({ id: ASSET_ID });
      expect(db.manager.update).not.toHaveBeenCalled();
    });
  });

  describe('delete and restore', () => {
    it('should delete an asset no creative holds', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row());

      await expect(service.delete(JANE, IDS.organization, ASSET_ID)).resolves.toMatchObject({ id: ASSET_ID });
      expect(db.manager.update).toHaveBeenCalledWith(AssetEntity, { id: ASSET_ID }, { deletedAt: expect.any(Date) });
    });

    it('should refuse to delete an asset a living creative uses, and say how many', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row());
      db.builder('link').getRawMany.mockResolvedValue([{ count: '2' }]);

      await expect(service.delete(JANE, IDS.organization, ASSET_ID)).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'asset_in_use',
        errorParams: { assetId: ASSET_ID, creatives: 2 },
      });
      expect(db.manager.update).not.toHaveBeenCalled();
    });

    it('should restore a deleted asset, and refuse one that lives', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row({ deletedAt: NOW }));
      await expect(service.restore(JANE, IDS.organization, ASSET_ID)).resolves.toEqual({
        id: ASSET_ID,
        deletedAt: null,
      });

      db.manager.findOne.mockResolvedValue(row());
      await expect(service.restore(JANE, IDS.organization, ASSET_ID)).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'asset_not_deleted',
      });
    });
  });

  describe('setLabels', () => {
    it('should replace the labels an asset carried', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row());

      const labelled: Asset = await service.setLabels(JANE, IDS.organization, ASSET_ID, { labelIds: [SPRING.id] });

      expect(labels.setOn).toHaveBeenCalledWith(db.manager, IDS.organization, 'asset', ASSET_ID, [SPRING.id]);
      expect(labelled.labels).toEqual([SPRING]);
    });
  });

  describe('countHolders', () => {
    it('should count the living creatives holding an asset', async (): Promise<void> => {
      db.builder('link').getRawMany.mockResolvedValue([{ count: '3' }]);

      await expect(service.countHolders(db.manager as never, ASSET_ID)).resolves.toBe(3);
    });

    it('should answer zero when the query answers nothing at all', async (): Promise<void> => {
      await expect(service.countHolders(db.manager as never, ASSET_ID)).resolves.toBe(0);
    });
  });

  describe('refusals of the access service', () => {
    it('should relay a refusal of the role, before reading anything', async (): Promise<void> => {
      access.assertOrganizationRole.mockRejectedValue(httpError(403, 'Requires the manager role'));

      await expect(service.delete(JANE, IDS.organization, ASSET_ID)).rejects.toMatchObject({ statusCode: 403 });
      expect(db.mocks.transaction).not.toHaveBeenCalled();
    });
  });

  describe('AssetServicePlugin', () => {
    it('should decorate the instance with an AssetService wired to its dependencies', async (): Promise<void> => {
      const app: FastifyInstance = await buildServiceApp([AssetServicePlugin], { db, access, labels, storage });
      db.manager.findOne.mockResolvedValue(row());

      expect(app.assetService).toBeInstanceOf(AssetService);
      await expect(app.assetService.get(JANE, IDS.organization, ASSET_ID)).resolves.toMatchObject({ id: ASSET_ID });

      await app.close();
    });
  });
});
