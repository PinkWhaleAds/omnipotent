import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The five levels of the campaign tree (phase 3, `docs/phase-3.md`).
 *
 * What to note, because the phases that extend the tree will meet it again:
 *
 * - the unique index on `(campaign_id, lever)` is **partial**, `WHERE deleted_at IS NULL`: a
 *   campaign carries at most one lever of each channel, and deleting one frees its channel — the
 *   same pattern as the names of phase 2;
 * - every foreign key is `ON DELETE RESTRICT`, deliberately: deleting is **soft** (D19), so the
 *   cascade on the subtree is the service's business and the database must refuse a real delete
 *   that would silently take rows with it;
 * - `organization_id` is denormalized onto the five levels, `campaign_id` onto the three lower ones
 *   and `lever` onto those three as well: every read is scoped by Organization, every write asks
 *   the lever profile, and a whole tree then reads as one query per level instead of a chain of
 *   joins. None of the three can drift — a node never changes Organization, campaign or channel;
 * - money is in **integer cents** in a `bigint`: an `integer` would cap at about 21 million euros,
 *   a ceiling nobody would see coming (`centsTransformer`);
 * - `budget_volume` keeps the entry that produced an amount (L25). The amount is the truth; the
 *   volume is there to be shown, and to be converted again if the bid CPM changes;
 * - `targeting_groups` has **no dates**: it is a targeting applied, not a period of delivery.
 *
 * Nothing is added to `label_assignments`: the five levels become labelable by the application
 * enumeration alone, which is exactly what the polymorphic table of D39 bought.
 */
export class CampaignTree1792952658715 implements MigrationInterface {
  name = 'CampaignTree1792952658715';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "campaigns" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "organization_id" uuid NOT NULL, "advertiser_id" uuid NOT NULL, "name" character varying(255) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'draft', "currency" character(3) NOT NULL, "timezone" character varying(64), "starts_on" date NOT NULL, "ends_on" date NOT NULL, "budget_cents" bigint NOT NULL, "budget_volume" bigint, "budget_volume_unit" character varying(16), "capping" jsonb, "insertion_order_number" character varying(64), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_831e3fcd4fc45b4e4c3f57a9ee4" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(`CREATE INDEX "IDX_b82fcefa3141cf82e4eb695b73" ON "campaigns" ("organization_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_b8e009ea9bab0dbbc4435c36ce" ON "campaigns" ("advertiser_id") `);
    await queryRunner.query(
      `CREATE TABLE "levers" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "organization_id" uuid NOT NULL, "campaign_id" uuid NOT NULL, "lever" character varying(16) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'active', "products_mode" boolean NOT NULL DEFAULT false, "platform_shares" jsonb NOT NULL, "budget_cents" bigint, "budget_volume" bigint, "budget_volume_unit" character varying(16), "starts_on" date, "ends_on" date, "capping" jsonb, "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_473c1daf494823b738ccd639c4a" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(`CREATE INDEX "IDX_c63a982c9c90c2a8e2988c6085" ON "levers" ("organization_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_59028e204c18c62753c56fdaa5" ON "levers" ("campaign_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_eba2cd917ffac2161b8a7dc3b1" ON "levers" ("campaign_id", "lever") WHERE "deleted_at" IS NULL`
    );
    await queryRunner.query(
      `CREATE TABLE "ad_groups" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "organization_id" uuid NOT NULL, "campaign_id" uuid NOT NULL, "lever_id" uuid NOT NULL, "lever" character varying(16) NOT NULL, "name" character varying(255) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'active', "objective" character varying(32) NOT NULL, "bid_strategy" character varying(32) NOT NULL, "bid_amount_cents" bigint, "platform_shares" jsonb, "budget_cents" bigint, "budget_volume" bigint, "budget_volume_unit" character varying(16), "starts_on" date, "ends_on" date, "capping" jsonb, "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_3344aaef9b6d136b90d542c835b" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(`CREATE INDEX "IDX_e539968d5ef229849c58f67eb3" ON "ad_groups" ("organization_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_06402f3308c59e92faec5ea1dc" ON "ad_groups" ("campaign_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_c1fb1878ad2adbb0848c691ece" ON "ad_groups" ("lever_id") `);
    await queryRunner.query(
      `CREATE TABLE "targeting_groups" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "organization_id" uuid NOT NULL, "campaign_id" uuid NOT NULL, "ad_group_id" uuid NOT NULL, "lever" character varying(16) NOT NULL, "name" character varying(255) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'active', "bid_amount_cents" bigint, "budget_cents" bigint, "budget_volume" bigint, "budget_volume_unit" character varying(16), "capping" jsonb, "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_2d99cc31ecadf3c8fdd3ee305b1" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(`CREATE INDEX "IDX_eed3701bc8e1d9bc1eaedaf74a" ON "targeting_groups" ("organization_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_a3b75c3a4fe25e28cdd5927165" ON "targeting_groups" ("campaign_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_cd61bab8d5486aaee8c1ac4d21" ON "targeting_groups" ("ad_group_id") `);
    await queryRunner.query(
      `CREATE TABLE "lines" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "organization_id" uuid NOT NULL, "campaign_id" uuid NOT NULL, "targeting_group_id" uuid NOT NULL, "lever" character varying(16) NOT NULL, "name" character varying(255) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'active', "landing_page_url" character varying(2048), "budget_cents" bigint, "budget_volume" bigint, "budget_volume_unit" character varying(16), "starts_on" date, "ends_on" date, "capping" jsonb, "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_155ad34738bc0e1aab0ca198dea" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(`CREATE INDEX "IDX_1fcadab7665a53629719a6c7de" ON "lines" ("organization_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_cd385af2fec57d1da90cf0c842" ON "lines" ("campaign_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_15e06e832267f8cfca1fbe7df4" ON "lines" ("targeting_group_id") `);
    await queryRunner.query(
      `ALTER TABLE "campaigns" ADD CONSTRAINT "FK_b8e009ea9bab0dbbc4435c36ce9" FOREIGN KEY ("advertiser_id") REFERENCES "advertisers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "levers" ADD CONSTRAINT "FK_59028e204c18c62753c56fdaa59" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "ad_groups" ADD CONSTRAINT "FK_c1fb1878ad2adbb0848c691ecee" FOREIGN KEY ("lever_id") REFERENCES "levers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "ad_groups" ADD CONSTRAINT "FK_06402f3308c59e92faec5ea1dcd" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "targeting_groups" ADD CONSTRAINT "FK_cd61bab8d5486aaee8c1ac4d212" FOREIGN KEY ("ad_group_id") REFERENCES "ad_groups"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "targeting_groups" ADD CONSTRAINT "FK_a3b75c3a4fe25e28cdd59271653" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "lines" ADD CONSTRAINT "FK_15e06e832267f8cfca1fbe7df4c" FOREIGN KEY ("targeting_group_id") REFERENCES "targeting_groups"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "lines" ADD CONSTRAINT "FK_cd385af2fec57d1da90cf0c8424" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lines" DROP CONSTRAINT "FK_cd385af2fec57d1da90cf0c8424"`);
    await queryRunner.query(`ALTER TABLE "lines" DROP CONSTRAINT "FK_15e06e832267f8cfca1fbe7df4c"`);
    await queryRunner.query(`ALTER TABLE "targeting_groups" DROP CONSTRAINT "FK_a3b75c3a4fe25e28cdd59271653"`);
    await queryRunner.query(`ALTER TABLE "targeting_groups" DROP CONSTRAINT "FK_cd61bab8d5486aaee8c1ac4d212"`);
    await queryRunner.query(`ALTER TABLE "ad_groups" DROP CONSTRAINT "FK_06402f3308c59e92faec5ea1dcd"`);
    await queryRunner.query(`ALTER TABLE "ad_groups" DROP CONSTRAINT "FK_c1fb1878ad2adbb0848c691ecee"`);
    await queryRunner.query(`ALTER TABLE "levers" DROP CONSTRAINT "FK_59028e204c18c62753c56fdaa59"`);
    await queryRunner.query(`ALTER TABLE "campaigns" DROP CONSTRAINT "FK_b8e009ea9bab0dbbc4435c36ce9"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_15e06e832267f8cfca1fbe7df4"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_cd385af2fec57d1da90cf0c842"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_1fcadab7665a53629719a6c7de"`);
    await queryRunner.query(`DROP TABLE "lines"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_cd61bab8d5486aaee8c1ac4d21"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_a3b75c3a4fe25e28cdd5927165"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_eed3701bc8e1d9bc1eaedaf74a"`);
    await queryRunner.query(`DROP TABLE "targeting_groups"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_c1fb1878ad2adbb0848c691ece"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_06402f3308c59e92faec5ea1dc"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e539968d5ef229849c58f67eb3"`);
    await queryRunner.query(`DROP TABLE "ad_groups"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_eba2cd917ffac2161b8a7dc3b1"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_59028e204c18c62753c56fdaa5"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_c63a982c9c90c2a8e2988c6085"`);
    await queryRunner.query(`DROP TABLE "levers"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b8e009ea9bab0dbbc4435c36ce"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b82fcefa3141cf82e4eb695b73"`);
    await queryRunner.query(`DROP TABLE "campaigns"`);
  }
}
