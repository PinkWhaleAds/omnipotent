import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Config } from 'jest';
import { pathsToModuleNameMapper } from 'ts-jest';

// The tsconfig is read, not imported: jest loads this file as ESM on a recent Node (which then demands
// `with { type: 'json' }`) and through ts-node in CommonJS on an older one (which refuses that attribute).
// Reading the file is the only form that works under both, and it keeps tsconfig.json the single source of
// truth for the path aliases. The path is relative to the working directory, which is this package's root:
// every script of package.json runs there.
const { compilerOptions }: { compilerOptions: { paths: Record<string, string[]> } } = JSON.parse(
  readFileSync(join(process.cwd(), 'tsconfig.json'), 'utf8')
) as { compilerOptions: { paths: Record<string, string[]> } };

/**
 * Integration suite: runs against a real PostgreSQL (the `postgres` service of
 * `compose.yaml` locally, a service container in CI). The global setup
 * recreates a dedicated `<DB_NAME>_it` database, so local data is never touched.
 */
const config: Config = {
  preset: 'ts-jest',
  roots: ['<rootDir>/test/integration'],
  globalSetup: '<rootDir>/test/integration/global-setup.ts',
  testTimeout: 30000,
  moduleNameMapper: {
    '^pg-boss$': '<rootDir>/test/stubs/pg-boss.stub.ts',
    ...pathsToModuleNameMapper(compilerOptions.paths, { prefix: '<rootDir>/' }),
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          types: ['jest', 'node'],
          module: 'CommonJS',
          moduleResolution: 'Node10',
          ignoreDeprecations: '6.0',
        },
      },
    ],
  },
};

export default config;
