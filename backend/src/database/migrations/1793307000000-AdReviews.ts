import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The verdict of each ad at each platform, kept on its unit beside its id, and when the verdicts were
 * last read (`docs/phase-10.md` § 8.8).
 */
export class AdReviews1793307000000 implements MigrationInterface {
  name = 'AdReviews1793307000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "platform_units" ADD "reviews" jsonb NOT NULL DEFAULT '{}'`);
    await queryRunner.query(`ALTER TABLE "platform_units" ADD "reviews_read_at" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "platform_units" DROP COLUMN "reviews_read_at"`);
    await queryRunner.query(`ALTER TABLE "platform_units" DROP COLUMN "reviews"`);
  }
}
