import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The targeting of the TargetingGroups, the reusable lists and the keywords (phase 5,
 * `docs/phase-5.md` § 1, § 3 and § 4).
 *
 * The targeting is **one jsonb column** on `targeting_groups`, not a table of rows: one write, one
 * read, and no N+1 to compose a desired state (`../../CADRAGE.md` § 8). Its **GIN** index is what
 * answers « which TargetingGroups still reference this list » in one question, which is the check a
 * list move depends on — it is declared here and ignored by the schema synchronization, TypeORM not
 * expressing an index method.
 *
 * The lists live at the Organization level, their name unique among the live ones of their kind. The
 * keywords hang from the **TargetingGroup** and not from the AdGroup as in multi-search, all the
 * targeting living on the TargetingGroup here; they are deleted outright, carrying no history worth
 * keeping, hence the cascade rather than a soft-delete.
 */
export class Targeting1792967310499 implements MigrationInterface {
  name = 'Targeting1792967310499';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "keywords" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "organization_id" uuid NOT NULL, "campaign_id" uuid NOT NULL, "targeting_group_id" uuid NOT NULL, "text" character varying(80) NOT NULL, "match_type" character varying(8) NOT NULL, "negative" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_4aa660a7a585ed828da68f3c28e" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(`CREATE INDEX "IDX_cb8d049165ae53e0a7a90d8269" ON "keywords" ("organization_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_3c85dbaced7ec5da07d5120c66" ON "keywords" ("campaign_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_98a52f9af543bb93c2067a39ce" ON "keywords" ("targeting_group_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_112336fc156cbbe9d830bca3e2" ON "keywords" ("targeting_group_id", "text", "match_type", "negative") `
    );
    await queryRunner.query(
      `CREATE TABLE "lists" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "organization_id" uuid NOT NULL, "kind" character varying(32) NOT NULL, "name" character varying(255) NOT NULL, "items" jsonb NOT NULL DEFAULT '[]'::jsonb, "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_268b525e9a6dd04d0685cb2aaaa" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(`CREATE INDEX "IDX_04b163ce7b81b948b37e6d7a46" ON "lists" ("organization_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_a7b645be32ebfc5f687b0e41bf" ON "lists" ("organization_id", "kind", "name") WHERE "deleted_at" IS NULL`
    );
    await queryRunner.query(`ALTER TABLE "targeting_groups" ADD "targeting" jsonb NOT NULL DEFAULT '{}'::jsonb`);
    await queryRunner.query(
      `ALTER TABLE "keywords" ADD CONSTRAINT "FK_98a52f9af543bb93c2067a39ce8" FOREIGN KEY ("targeting_group_id") REFERENCES "targeting_groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_targeting_groups_targeting" ON "targeting_groups" USING GIN ("targeting")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_targeting_groups_targeting"`);
    await queryRunner.query(`ALTER TABLE "keywords" DROP CONSTRAINT "FK_98a52f9af543bb93c2067a39ce8"`);
    await queryRunner.query(`ALTER TABLE "targeting_groups" DROP COLUMN "targeting"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_a7b645be32ebfc5f687b0e41bf"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_04b163ce7b81b948b37e6d7a46"`);
    await queryRunner.query(`DROP TABLE "lists"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_112336fc156cbbe9d830bca3e2"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_98a52f9af543bb93c2067a39ce"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_3c85dbaced7ec5da07d5120c66"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_cb8d049165ae53e0a7a90d8269"`);
    await queryRunner.query(`DROP TABLE "keywords"`);
  }
}
