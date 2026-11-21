import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The referential of places: Google's catalog, and the trigram index its search reads
 * (`docs/phase-10.md` § 8.9, D57). Transcribed from multi-search (`GeoTargeting1791538184546`), without
 * its table of the other platforms' ids, which comes with lot B of phase 11.
 *
 * `pg_trgm` is a trusted extension: the owner of the database may create it, on RDS too.
 */
export class GeoLocations1793308000000 implements MigrationInterface {
  name = 'GeoLocations1793308000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "geo_locations" ("id" character varying(12) NOT NULL, "name" character varying(255) NOT NULL, "canonical_name" character varying(500) NOT NULL, "search_text" character varying(800) NOT NULL, "parent_id" character varying(12), "country_code" character(2), "target_type" character varying(40) NOT NULL, "level" character varying(16), "status" character varying(20) NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_7a01c2056cca1c74e5f1c14c7b0" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9df1e38244d6727b2a6dbc818e" ON "geo_locations" ("country_code", "level") `
    );
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await queryRunner.query(
      `CREATE INDEX "IDX_geo_locations_search_trgm" ON "geo_locations" USING gin ("search_text" gin_trgm_ops)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_geo_locations_search_trgm"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_9df1e38244d6727b2a6dbc818e"`);
    await queryRunner.query(`DROP TABLE "geo_locations"`);
  }
}
