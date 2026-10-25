// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  { ignores: ['dist/**/*', 'coverage/**/*', 'coverage-unit/**/*', '.pnpm-store/**/*'] },
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      indent: ['error', 2, { SwitchCase: 2 }],
      semi: ['error', 'always'],
      '@typescript-eslint/array-type': ['error', { default: 'array' }],
      // A parameter named `_x` is deliberately unused: a signature imposed by an interface, a Fastify
      // hook or the MCP SDK, which a later phase will read. The rule's default (`args: 'after-used'`)
      // already allows it before a used parameter; this says so in every position.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      // Disabled: MCP SDK requires `type` aliases (interfaces don't satisfy index signatures).
      '@typescript-eslint/consistent-type-definitions': 'off',
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-empty-function': 'off',
    },
  },
  eslintConfigPrettier
);
