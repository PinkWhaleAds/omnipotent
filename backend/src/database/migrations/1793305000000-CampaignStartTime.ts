import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The time of day a campaign starts, on its first day, in its timezone (`docs/phase-10.md` § 8.4,
 * point 3). `NULL` is midnight, which is what every campaign already there meant.
 */
export class CampaignStartTime1793305000000 implements MigrationInterface {
  name = 'CampaignStartTime1793305000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "campaigns" ADD "start_time" character varying(5)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "campaigns" DROP COLUMN "start_time"`);
  }
}
