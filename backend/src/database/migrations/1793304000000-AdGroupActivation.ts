import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * When an AdGroup was first activated in a launched campaign (`docs/phase-10.md` § 8.4, point 2).
 *
 * An AdGroup never activated reaches no platform: it has no unit (`../../CADRAGE.md` § 13). The
 * AdGroups of a campaign already launched were all sent when it was, active or not — that was the
 * engine's behaviour before this column — so they count as activated at their campaign's last write,
 * and keep the units they have.
 */
export class AdGroupActivation1793304000000 implements MigrationInterface {
  name = 'AdGroupActivation1793304000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ad_groups" ADD "activated_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(
      `UPDATE "ad_groups" AS "group" SET "activated_at" = "campaign"."updated_at"
         FROM "campaigns" AS "campaign"
        WHERE "campaign"."id" = "group"."campaign_id" AND "campaign"."status" <> 'draft'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ad_groups" DROP COLUMN "activated_at"`);
  }
}
