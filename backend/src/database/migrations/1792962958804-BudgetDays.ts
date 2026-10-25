import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The daily curves of the five levels, in one table (phase 4, `docs/phase-4.md` § 1).
 *
 * The unique index is on the triplet `(level, node_id, day)`: one amount per day per node, and the
 * level in the key rather than in the table name — the curve of an AdGroup and the curve of a
 * campaign are the same thing. A sixth resource carrying a budget will have nothing to migrate.
 *
 * No foreign key to the node, its level varying: the same compromise as the polymorphic label
 * assignments (D39). The nodes being soft-deleted an orphan curve is harmless, and a curve is only
 * written once someone has shaped it — a node nobody touched answers a flat curve computed at read
 * time, so it costs no row.
 */
export class BudgetDays1792962958804 implements MigrationInterface {
  name = 'BudgetDays1792962958804';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "budget_days" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "level" character varying(32) NOT NULL, "node_id" uuid NOT NULL, "day" date NOT NULL, "cents" bigint NOT NULL, "locked" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_a908ec11d619e5a478ddb4e0185" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(`CREATE INDEX "IDX_a13ddb785590d03ef3a8a7799e" ON "budget_days" ("level", "node_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_c325a791e479d27708bff3694a" ON "budget_days" ("level", "node_id", "day") `
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_c325a791e479d27708bff3694a"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_a13ddb785590d03ef3a8a7799e"`);
    await queryRunner.query(`DROP TABLE "budget_days"`);
  }
}
