import type { Config } from 'jest';
import { pathsToModuleNameMapper } from 'ts-jest';

// No import attribute: ts-node compiles this file with `module: CommonJS` (tsconfig.json), which TypeScript
// refuses them on, and `resolveJsonModule` already makes the plain import work.
import tsconfig from './tsconfig.json';
const { compilerOptions } = tsconfig;

const config: Config = {
  preset: 'ts-jest',
  roots: ['<rootDir>/test/unit'],
  coverageProvider: 'v8',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/index.ts',
    '!src/instrumentation.ts',
    '!src/types/**/*.ts',
    // Decorator-driven table shapes and generated SQL: exercised by the
    // integration suite against a real PostgreSQL (`pnpm test:integration`).
    '!src/database/entities/**',
    '!src/database/migrations/**',
    // Command-line entry points (TypeORM CLI, standalone migration runner, local commands).
    '!src/database/cli-data-source.ts',
    '!src/database/migrate.ts',
    '!src/scripts/**',
  ],
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
  moduleNameMapper: {
    // pg-boss ships as pure ESM, which jest (ts-jest in CommonJS mode) cannot
    // require: map it to a parseable CommonJS stub (see the stub's header).
    '^pg-boss$': '<rootDir>/test/stubs/pg-boss.stub.ts',
    ...pathsToModuleNameMapper(compilerOptions.paths, { prefix: '<rootDir>/' }),
  },
  // ts-jest configuration to ensure @types/jest globals are resolved
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
