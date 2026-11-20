import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What a Search campaign of multi-search carries and ours did not (`docs/phase-10.md` § 8.4, points
 * 4 to 6): the settings of each platform and the extensions, on the Lever, and who a place reaches,
 * on the AdGroup.
 */
export class SearchSettings1793306000000 implements MigrationInterface {
  name = 'SearchSettings1793306000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "levers" ADD "platform_settings" jsonb NOT NULL DEFAULT '{}'`);
    await queryRunner.query(`ALTER TABLE "levers" ADD "extensions" jsonb`);
    await queryRunner.query(`ALTER TABLE "ad_groups" ADD "location_intent" character varying(32)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ad_groups" DROP COLUMN "location_intent"`);
    await queryRunner.query(`ALTER TABLE "levers" DROP COLUMN "extensions"`);
    await queryRunner.query(`ALTER TABLE "levers" DROP COLUMN "platform_settings"`);
  }
}
