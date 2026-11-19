import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The accounts linked to our manager account (`docs/phase-10.md` § 4.4 and § 4.5).
 *
 * - `name`, `currency` and `timezone` become **nullable**: an account linked to our manager account
 *   has none until its client accepts, and they are then read at the platform, never declared;
 * - `link_ref` keeps the account as its client reads it, and `link_requested_at` when the last
 *   invitation left;
 * - a linked account belongs to **one** Organization among the living rows, whichever it is.
 */
export class LinkedAccounts1793218800000 implements MigrationInterface {
  name = 'LinkedAccounts1793218800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ad_accounts" ALTER COLUMN "name" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "ad_accounts" ALTER COLUMN "currency" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "ad_accounts" ALTER COLUMN "timezone" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "ad_accounts" ADD "link_ref" character varying(128)`);
    await queryRunner.query(`ALTER TABLE "ad_accounts" ADD "link_requested_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_2ab764e606fbf73bf3a258e7c6" ON "ad_accounts" ("platform", "link_ref") WHERE "deleted_at" IS NULL AND "link_ref" IS NOT NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_2ab764e606fbf73bf3a258e7c6"`);
    await queryRunner.query(`ALTER TABLE "ad_accounts" DROP COLUMN "link_requested_at"`);
    await queryRunner.query(`ALTER TABLE "ad_accounts" DROP COLUMN "link_ref"`);
    // The rows of a linked account with no name, currency or timezone yet cannot go back: the
    // former schema required all three.
    await queryRunner.query(
      `DELETE FROM "ad_accounts" WHERE "currency" IS NULL OR "timezone" IS NULL OR "name" IS NULL`
    );
    await queryRunner.query(`ALTER TABLE "ad_accounts" ALTER COLUMN "timezone" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "ad_accounts" ALTER COLUMN "currency" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "ad_accounts" ALTER COLUMN "name" SET NOT NULL`);
  }
}
