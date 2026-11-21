import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The conversions of lot 3d (D58, `docs/phase-10.md` § 8.10): the goals of the Advertisers, where each
 * stands on each ad account, the tracking code of each Advertiser on each account, the public key of
 * its script and when its site last loaded it, and the goal an AdGroup optimizes.
 */
export class Conversions1793309000000 implements MigrationInterface {
  name = 'Conversions1793309000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "advertiser_trackings" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "advertiser_id" uuid NOT NULL, "ad_account_id" uuid NOT NULL, "platform" character varying(32) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'pending', "refs" jsonb NOT NULL DEFAULT '{}', "message" text, "message_code" character varying(64), "message_params" jsonb, CONSTRAINT "PK_7b67a76d9d768d3dc34b5767b98" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_945de0abd6c92c2fa00cb2d7d9" ON "advertiser_trackings" ("ad_account_id") `
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_8ac7bdbd25f270b32c9c109a02" ON "advertiser_trackings" ("advertiser_id", "ad_account_id") `
    );
    await queryRunner.query(
      `CREATE TABLE "conversion_goal_refs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "goal_id" uuid NOT NULL, "ad_account_id" uuid NOT NULL, "platform" character varying(32) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'pending', "refs" jsonb NOT NULL DEFAULT '{}', "biddable" boolean NOT NULL DEFAULT false, "message" text, "message_code" character varying(64), "message_params" jsonb, "synced_hash" character varying(64), CONSTRAINT "PK_e4f1c79df7479dd526c1f52845b" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_74eeca6aa270c181b20d9d15ca" ON "conversion_goal_refs" ("ad_account_id") `
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_26861a35c4a92b5875a9da00ea" ON "conversion_goal_refs" ("goal_id", "ad_account_id") `
    );
    await queryRunner.query(
      `CREATE TABLE "conversion_goals" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "organization_id" uuid NOT NULL, "advertiser_id" uuid NOT NULL, "key" character varying(40) NOT NULL, "name" character varying(80) NOT NULL, "category" character varying(24) NOT NULL, "value_mode" character varying(8) NOT NULL DEFAULT 'none', "default_value_cents" bigint, "currency" character(3), "counting" character varying(8) NOT NULL DEFAULT 'every', "status" character varying(16) NOT NULL DEFAULT 'active', CONSTRAINT "PK_6899f7f8c4ddce8b3bc9b7e7b97" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(`CREATE INDEX "IDX_b349c737757e4ca284afcce7c8" ON "conversion_goals" ("organization_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_d13feb82fd8c373b3a391cb41b" ON "conversion_goals" ("advertiser_id", "key") `
    );
    await queryRunner.query(`ALTER TABLE "advertisers" ADD "tracking_key" character varying(32)`);
    await queryRunner.query(`ALTER TABLE "advertisers" ADD "script_seen_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "ad_groups" ADD "conversion_goal_id" uuid`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_40c7a5fce23c9ebc61c6db5401" ON "advertisers" ("tracking_key") WHERE "tracking_key" IS NOT NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_40c7a5fce23c9ebc61c6db5401"`);
    await queryRunner.query(`ALTER TABLE "ad_groups" DROP COLUMN "conversion_goal_id"`);
    await queryRunner.query(`ALTER TABLE "advertisers" DROP COLUMN "script_seen_at"`);
    await queryRunner.query(`ALTER TABLE "advertisers" DROP COLUMN "tracking_key"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_d13feb82fd8c373b3a391cb41b"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b349c737757e4ca284afcce7c8"`);
    await queryRunner.query(`DROP TABLE "conversion_goals"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_26861a35c4a92b5875a9da00ea"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_74eeca6aa270c181b20d9d15ca"`);
    await queryRunner.query(`DROP TABLE "conversion_goal_refs"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_8ac7bdbd25f270b32c9c109a02"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_945de0abd6c92c2fa00cb2d7d9"`);
    await queryRunner.query(`DROP TABLE "advertiser_trackings"`);
  }
}
