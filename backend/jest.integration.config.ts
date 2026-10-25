import type { Config } from 'jest';
import { pathsToModuleNameMapper } from 'ts-jest';

// No import attribute: ts-node compiles this file with `module: CommonJS` (tsconfig.json), which TypeScript
// refuses them on, and `resolveJsonModule` already makes the plain import work.
import tsconfig from './tsconfig.json';
const { compilerOptions } = tsconfig;

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
