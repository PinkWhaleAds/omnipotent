import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The first migration: Advertisers, Labels and the polymorphic assignment of a Label to a resource
 * (phase 2, `docs/phase-2.md`).
 *
 * Three things to note, because the next migrations copy them:
 *
 * - `organization_id` is a plain `uuid` with **no foreign key**: the Organization lives in omnipass
 *   and nothing constrains it across the two databases (T4);
 * - the unique index on `(organization_id, name)` is **partial**, `WHERE deleted_at IS NULL`, so
 *   deleting a resource frees its name and recreating it is not refused;
 * - `label_assignments.resource_type` is a `varchar`, not a PostgreSQL enum: making a new kind of
 *   resource labelable must cost no migration (D39).
 */
export class AdvertisersAndLabels1792936887388 implements MigrationInterface {
  name = 'AdvertisersAndLabels1792936887388';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "advertisers" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "organization_id" uuid NOT NULL, "name" character varying(255) NOT NULL, "website_url" character varying(2048), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_a0618516584bd6609576d6a9ff5" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(`CREATE INDEX "IDX_4318094bd7f4131a65ea6db2b0" ON "advertisers" ("organization_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_bb92ab4252dbee3ccfda7559c6" ON "advertisers" ("organization_id", "name") WHERE "deleted_at" IS NULL`
    );
    await queryRunner.query(
      `CREATE TABLE "label_assignments" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "label_id" uuid NOT NULL, "resource_type" character varying(32) NOT NULL, "resource_id" uuid NOT NULL, CONSTRAINT "PK_843928de46f3b4c0b4b3215aef6" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(`CREATE INDEX "IDX_67617abdd1095d4ce7e5434afb" ON "label_assignments" ("label_id") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_9533edd556d2898df36f2bdf39" ON "label_assignments" ("resource_type", "resource_id") `
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_9212370b2e05eea2c85ae44826" ON "label_assignments" ("label_id", "resource_type", "resource_id") `
    );
    await queryRunner.query(
      `CREATE TABLE "labels" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "organization_id" uuid NOT NULL, "name" character varying(64) NOT NULL, "color" character varying(7) NOT NULL, "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_c0c4e97f76f1f3a268c7a70b925" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(`CREATE INDEX "IDX_3be29341d1c35caa8bc4dd608b" ON "labels" ("organization_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_df725594cd03441aeaeeaf985e" ON "labels" ("organization_id", "name") WHERE "deleted_at" IS NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_df725594cd03441aeaeeaf985e"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_3be29341d1c35caa8bc4dd608b"`);
    await queryRunner.query(`DROP TABLE "labels"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_9212370b2e05eea2c85ae44826"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_9533edd556d2898df36f2bdf39"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_67617abdd1095d4ce7e5434afb"`);
    await queryRunner.query(`DROP TABLE "label_assignments"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_bb92ab4252dbee3ccfda7559c6"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_4318094bd7f4131a65ea6db2b0"`);
    await queryRunner.query(`DROP TABLE "advertisers"`);
  }
}
