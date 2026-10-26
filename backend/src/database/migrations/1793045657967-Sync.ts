import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The synchronization by desired state (phase 9, `docs/phase-9.md` § 2).
 *
 * `platform_units` is unique on `(ad_group, platform)`: that couple is the grain of the engine — what
 * a platform treats as a whole and what one call of an adapter applies. Its **partial index on
 * `next_attempt_at`** is what makes D34 true: the sweep reads only the units with something left to
 * apply, so the periodic cost follows the backlog and not the size of the database.
 *
 * `external_id_history` is **append-only**, and a trigger enforces it rather than a convention: a
 * report about the previous days still carries the old id, and R5 only holds if no code — ours or a
 * future one — can rewrite that trail.
 *
 * `campaigns.next_pacing_at` replaces a sweep of the whole fleet by one appointment per campaign at
 * its own local midnight (D34 rule 2, D47).
 */
export class Sync1793045657967 implements MigrationInterface {
  name = 'Sync1793045657967';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "external_id_history" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "organization_id" uuid NOT NULL, "platform_unit_id" uuid NOT NULL, "platform" character varying(32) NOT NULL, "level" character varying(16) NOT NULL, "node_id" uuid, "ref_key" character varying(128) NOT NULL, "previous_external_id" character varying(128) NOT NULL, "external_id" character varying(128) NOT NULL, CONSTRAINT "PK_d7a57c1dac553cc6fb123dba07b" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3bf289a56cab286e70589c3b4f" ON "external_id_history" ("organization_id") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ab928e87e7a56c70452e96234f" ON "external_id_history" ("platform_unit_id") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6cb074e3fa1a7661999e11d74b" ON "external_id_history" ("platform", "previous_external_id") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3cdcda99d0a361712e168f1bbb" ON "external_id_history" ("platform", "level", "node_id") `
    );
    await queryRunner.query(
      `CREATE TABLE "platform_calls" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "platform" character varying(32) NOT NULL, "ad_account_id" uuid, "method" character varying(8) NOT NULL, "path" character varying(512) NOT NULL, "status_code" integer, "duration_ms" integer NOT NULL, "request_id" character varying(128), "error" text, "operations" integer NOT NULL DEFAULT '1', CONSTRAINT "PK_fb3ff5ac7daaeb0a595bea6d29d" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(`CREATE INDEX "IDX_753e0c9a8795a6fecefe133344" ON "platform_calls" ("ad_account_id") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_48fec872fb32fe677dca54661e" ON "platform_calls" ("platform", "created_at") `
    );
    await queryRunner.query(`CREATE INDEX "IDX_fc2ed2fe1f6182c915f5382db2" ON "platform_calls" ("created_at") `);
    await queryRunner.query(
      `CREATE TABLE "platform_units" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "organization_id" uuid NOT NULL, "campaign_id" uuid NOT NULL, "lever_id" uuid NOT NULL, "ad_group_id" uuid NOT NULL, "lever" character varying(16) NOT NULL, "platform" character varying(32) NOT NULL, "ad_account_id" uuid NOT NULL, "fx_rate" numeric(18,8) NOT NULL DEFAULT '1', "refs" jsonb NOT NULL DEFAULT '{}', "applied_status" character varying(16), "sync_state" character varying(16) NOT NULL DEFAULT 'pending', "synced_hash" character varying(64), "last_error" text, "last_error_code" character varying(64), "last_error_params" jsonb, "attempts" integer NOT NULL DEFAULT '0', "next_attempt_at" TIMESTAMP WITH TIME ZONE, "last_attempt_at" TIMESTAMP WITH TIME ZONE, "last_synced_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_793e135daef681f54e3fa68a631" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(`CREATE INDEX "IDX_1329b0aa2e13262e610e835281" ON "platform_units" ("organization_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_4ad5ea87496d039b410522f3e8" ON "platform_units" ("campaign_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_26a4a70c06c79705d07484b6dc" ON "platform_units" ("ad_account_id") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_0c0bcfdc32aad65021df3bb9cf" ON "platform_units" ("next_attempt_at") WHERE "sync_state" IN ('pending', 'error')`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_99f0b1574585a53606836296bd" ON "platform_units" ("ad_group_id", "platform") `
    );
    await queryRunner.query(`ALTER TABLE "campaigns" ADD "next_pacing_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(
      `CREATE INDEX "IDX_b181a4c079e18ec0d24043a752" ON "campaigns" ("next_pacing_at") WHERE "next_pacing_at" IS NOT NULL`
    );
    // R5 made real: the trail of platform ids is written once and never rewritten, whoever asks.
    await queryRunner.query(
      `CREATE FUNCTION "external_id_history_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'external_id_history is append-only'; END; $$`
    );
    await queryRunner.query(
      `CREATE TRIGGER "external_id_history_append_only" BEFORE UPDATE OR DELETE ON "external_id_history" FOR EACH ROW EXECUTE FUNCTION "external_id_history_append_only"()`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER "external_id_history_append_only" ON "external_id_history"`);
    await queryRunner.query(`DROP FUNCTION "external_id_history_append_only"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b181a4c079e18ec0d24043a752"`);
    await queryRunner.query(`ALTER TABLE "campaigns" DROP COLUMN "next_pacing_at"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_99f0b1574585a53606836296bd"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_0c0bcfdc32aad65021df3bb9cf"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_26a4a70c06c79705d07484b6dc"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_4ad5ea87496d039b410522f3e8"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_1329b0aa2e13262e610e835281"`);
    await queryRunner.query(`DROP TABLE "platform_units"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_fc2ed2fe1f6182c915f5382db2"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_48fec872fb32fe677dca54661e"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_753e0c9a8795a6fecefe133344"`);
    await queryRunner.query(`DROP TABLE "platform_calls"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_3cdcda99d0a361712e168f1bbb"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_6cb074e3fa1a7661999e11d74b"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ab928e87e7a56c70452e96234f"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_3bf289a56cab286e70589c3b4f"`);
    await queryRunner.query(`DROP TABLE "external_id_history"`);
  }
}
