import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The platform accounts and the sub-advertisers (phase 7, `docs/phase-7.md` § 1).
 *
 * `ad_accounts` is unique on `(organization, platform, external_id)` among the living ones: one
 * Organization connects a given account once, and **several accounts of one platform** are allowed —
 * several advertisers, several currencies — which is what the `DspConnection` of MBP forbade.
 *
 * `advertiser_ad_accounts` is unique on `(advertiser, platform, currency)`: a brand buys on one
 * account per currency and per platform, the question the synchronization asks at every push.
 *
 * **No credential is stored here**: `secret_name` holds the name of an AWS Secrets Manager entry, and
 * nothing in this schema can answer its value (`../../CADRAGE.md` § 12).
 */
export class PlatformAccounts1793010942785 implements MigrationInterface {
  name = 'PlatformAccounts1793010942785';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ad_accounts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "organization_id" uuid NOT NULL, "platform" character varying(32) NOT NULL, "external_id" character varying(128) NOT NULL, "name" character varying(255) NOT NULL, "currency" character varying(3) NOT NULL, "timezone" character varying(64) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'pending', "status_reason" character varying(32), "scope" jsonb NOT NULL DEFAULT '{}', "secret_name" character varying(512), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_7f3f9205ab9fc8719688750795e" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(`CREATE INDEX "IDX_cb696d80828e97c22cb308899b" ON "ad_accounts" ("organization_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_430e0566b5ea94462ff072d101" ON "ad_accounts" ("organization_id", "platform", "external_id") WHERE "deleted_at" IS NULL`
    );
    await queryRunner.query(
      `CREATE TABLE "advertiser_ad_accounts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "organization_id" uuid NOT NULL, "advertiser_id" uuid NOT NULL, "platform" character varying(32) NOT NULL, "currency" character varying(3) NOT NULL, "ad_account_id" uuid NOT NULL, "external_advertiser_id" character varying(128) NOT NULL, "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_42d5755828a813d9653a5264eb1" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3a03b00063396cc23ccb8c7dae" ON "advertiser_ad_accounts" ("organization_id") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e873832084d4a7c9ac273833e1" ON "advertiser_ad_accounts" ("advertiser_id") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3b0accea2d737fe571bd584e2b" ON "advertiser_ad_accounts" ("ad_account_id") `
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_e844a505b4c311872193c1b8b7" ON "advertiser_ad_accounts" ("advertiser_id", "platform", "currency") WHERE "deleted_at" IS NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "advertiser_ad_accounts" ADD CONSTRAINT "FK_e873832084d4a7c9ac273833e18" FOREIGN KEY ("advertiser_id") REFERENCES "advertisers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "advertiser_ad_accounts" ADD CONSTRAINT "FK_3b0accea2d737fe571bd584e2ba" FOREIGN KEY ("ad_account_id") REFERENCES "ad_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "advertiser_ad_accounts" DROP CONSTRAINT "FK_3b0accea2d737fe571bd584e2ba"`);
    await queryRunner.query(`ALTER TABLE "advertiser_ad_accounts" DROP CONSTRAINT "FK_e873832084d4a7c9ac273833e18"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e844a505b4c311872193c1b8b7"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_3b0accea2d737fe571bd584e2b"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e873832084d4a7c9ac273833e1"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_3a03b00063396cc23ccb8c7dae"`);
    await queryRunner.query(`DROP TABLE "advertiser_ad_accounts"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_430e0566b5ea94462ff072d101"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_cb696d80828e97c22cb308899b"`);
    await queryRunner.query(`DROP TABLE "ad_accounts"`);
  }
}
