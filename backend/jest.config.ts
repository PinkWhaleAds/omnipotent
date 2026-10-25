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
