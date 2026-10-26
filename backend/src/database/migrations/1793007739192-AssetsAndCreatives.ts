import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The library of an Advertiser: its assets, its creatives and their versions (phase 6,
 * `docs/phase-6.md` § 1).
 *
 * The **fingerprint** of an asset is unique per Advertiser among the living ones: the same file twice
 * is the same asset, and two brands using the same image each keep their own. The link between an
 * asset and a version is `RESTRICT` on the asset side — an asset a living version uses is never
 * deleted outright — and `CASCADE` on the version side, a version's links going with it.
 *
 * A version is unique on `(creative, version)`, and the creative points at the one that delivers
 * **without a foreign key**: a version already points at its creative, and the reverse would close a
 * cycle every insert would have to break.
 *
 * The `Line` gains the creative it serves and the override of its trackers (L18), with the
 * uniqueness `(targeting_group, creative)` among the living Lines: the same creative does not deliver
 * twice on the same targeting.
 */
export class AssetsAndCreatives1793007739192 implements MigrationInterface {
  name = 'AssetsAndCreatives1793007739192';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "assets" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "organization_id" uuid NOT NULL, "advertiser_id" uuid NOT NULL, "file_name" character varying(255) NOT NULL, "kind" character varying(16) NOT NULL, "mime_type" character varying(128) NOT NULL, "size_bytes" bigint NOT NULL, "width" integer, "height" integer, "duration_ms" integer, "fingerprint" character varying(64) NOT NULL, "provenance" character varying(16) NOT NULL DEFAULT 'uploaded', "ai_generation_id" uuid, "storage_key" character varying(1024) NOT NULL, "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_da96729a8b113377cfb6a62439c" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(`CREATE INDEX "IDX_1d6ef9c90d6709e779cde626c3" ON "assets" ("organization_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_5fd8efaa389725fb9b0dcac202" ON "assets" ("advertiser_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_345db050be5acff679eacb7cc7" ON "assets" ("advertiser_id", "fingerprint") WHERE "deleted_at" IS NULL`
    );
    await queryRunner.query(
      `CREATE TABLE "creatives" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "organization_id" uuid NOT NULL, "advertiser_id" uuid NOT NULL, "name" character varying(255) NOT NULL, "format" character varying(16) NOT NULL, "subtype" character varying(16) NOT NULL, "iab_categories" jsonb NOT NULL DEFAULT '[]', "iab_taxonomy_version" character varying(16), "click_through_url" character varying(2048), "active_version_id" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_fb146841da64b2b38449f618daf" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(`CREATE INDEX "IDX_a9257a40a0a87e9c53c9e4eac1" ON "creatives" ("organization_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_9988b5c27feb29ada20f76ebc7" ON "creatives" ("advertiser_id") `);
    await queryRunner.query(
      `CREATE TABLE "creative_versions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "organization_id" uuid NOT NULL, "creative_id" uuid NOT NULL, "version" integer NOT NULL, "payload" jsonb NOT NULL DEFAULT '{}', "trackers" jsonb NOT NULL DEFAULT '[]', CONSTRAINT "PK_31d35a8bea117e46287e1ce301f" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cd29ffb239757f11f213b8d483" ON "creative_versions" ("organization_id") `
    );
    await queryRunner.query(`CREATE INDEX "IDX_1a65834418e919ec2b3b4469af" ON "creative_versions" ("creative_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_694b5d678b9e74afca62ea1d8c" ON "creative_versions" ("creative_id", "version") `
    );
    await queryRunner.query(
      `CREATE TABLE "creative_version_assets" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "version_id" uuid NOT NULL, "asset_id" uuid NOT NULL, "role" character varying(16) NOT NULL, CONSTRAINT "PK_492a743c6bd10fc01b16aad0d93" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(`CREATE INDEX "IDX_4931587d3ee6fc73706e1cb39d" ON "creative_version_assets" ("asset_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_07ce1bb48c0392d1ea62588b5a" ON "creative_version_assets" ("version_id", "role", "asset_id") `
    );
    await queryRunner.query(`ALTER TABLE "lines" ADD "creative_id" uuid`);
    await queryRunner.query(`ALTER TABLE "lines" ADD "trackers" jsonb`);
    await queryRunner.query(`CREATE INDEX "IDX_d0b36e811e830dccd395678a4f" ON "lines" ("creative_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_4aa44367e977ad2bc8d50881eb" ON "lines" ("targeting_group_id", "creative_id") WHERE "deleted_at" IS NULL AND "creative_id" IS NOT NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "assets" ADD CONSTRAINT "FK_5fd8efaa389725fb9b0dcac2027" FOREIGN KEY ("advertiser_id") REFERENCES "advertisers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "creatives" ADD CONSTRAINT "FK_9988b5c27feb29ada20f76ebc72" FOREIGN KEY ("advertiser_id") REFERENCES "advertisers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "creative_versions" ADD CONSTRAINT "FK_1a65834418e919ec2b3b4469af2" FOREIGN KEY ("creative_id") REFERENCES "creatives"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "creative_version_assets" ADD CONSTRAINT "FK_cebaf5b20805f73e3fc2f36a39e" FOREIGN KEY ("version_id") REFERENCES "creative_versions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "creative_version_assets" ADD CONSTRAINT "FK_4931587d3ee6fc73706e1cb39dc" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "lines" ADD CONSTRAINT "FK_d0b36e811e830dccd395678a4f8" FOREIGN KEY ("creative_id") REFERENCES "creatives"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lines" DROP CONSTRAINT "FK_d0b36e811e830dccd395678a4f8"`);
    await queryRunner.query(`ALTER TABLE "creative_version_assets" DROP CONSTRAINT "FK_4931587d3ee6fc73706e1cb39dc"`);
    await queryRunner.query(`ALTER TABLE "creative_version_assets" DROP CONSTRAINT "FK_cebaf5b20805f73e3fc2f36a39e"`);
    await queryRunner.query(`ALTER TABLE "creative_versions" DROP CONSTRAINT "FK_1a65834418e919ec2b3b4469af2"`);
    await queryRunner.query(`ALTER TABLE "creatives" DROP CONSTRAINT "FK_9988b5c27feb29ada20f76ebc72"`);
    await queryRunner.query(`ALTER TABLE "assets" DROP CONSTRAINT "FK_5fd8efaa389725fb9b0dcac2027"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_4aa44367e977ad2bc8d50881eb"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_d0b36e811e830dccd395678a4f"`);
    await queryRunner.query(`ALTER TABLE "lines" DROP COLUMN "trackers"`);
    await queryRunner.query(`ALTER TABLE "lines" DROP COLUMN "creative_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_07ce1bb48c0392d1ea62588b5a"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_4931587d3ee6fc73706e1cb39d"`);
    await queryRunner.query(`DROP TABLE "creative_version_assets"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_694b5d678b9e74afca62ea1d8c"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_1a65834418e919ec2b3b4469af"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_cd29ffb239757f11f213b8d483"`);
    await queryRunner.query(`DROP TABLE "creative_versions"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_9988b5c27feb29ada20f76ebc7"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_a9257a40a0a87e9c53c9e4eac1"`);
    await queryRunner.query(`DROP TABLE "creatives"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_345db050be5acff679eacb7cc7"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_5fd8efaa389725fb9b0dcac202"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_1d6ef9c90d6709e779cde626c3"`);
    await queryRunner.query(`DROP TABLE "assets"`);
  }
}
