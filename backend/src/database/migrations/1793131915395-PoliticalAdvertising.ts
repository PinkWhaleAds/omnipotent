import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The political advertising declaration every campaign carries (D53).
 *
 * The column is **`NOT NULL` without a default**: a campaign states what it is, and nothing may
 * insert one that says nothing. The default below exists only for the rows already there — none in
 * production, since nothing is deployed yet, but a developer's database has some — and is dropped in
 * the same migration, so the schema that remains is the one the entity declares.
 */
export class PoliticalAdvertising1793131915395 implements MigrationInterface {
  name = 'PoliticalAdvertising1793131915395';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "campaigns" ADD "contains_political_advertising" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "contains_political_advertising" DROP DEFAULT`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "campaigns" DROP COLUMN "contains_political_advertising"`);
  }
}
