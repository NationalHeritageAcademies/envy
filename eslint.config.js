import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'out/',
      'dist/',
      'coverage/',
      'node_modules/',
      'web/',
      'docs/',
      'build/',
    ],
  },

  js.configs.recommended,

  // Plain JS/CJS/MJS (build + packaging scripts): recommended rules only, no type-aware linting.
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: { ...globals.node },
      sourceType: 'commonjs',
    },
  },
  {
    files: ['**/*.mjs', 'eslint.config.js', 'electron.vite.config.ts'],
    languageOptions: { sourceType: 'module' },
  },

  // TypeScript: typed linting against the repo tsconfigs.
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.ts', '**/*.tsx'],
  })),
  ...tseslint.configs.stylisticTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.ts', '**/*.tsx'],
  })),
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: {
          defaultProject: 'tsconfig.json',
        },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // tsconfig sets noUncheckedIndexedAccess, so `arr[0]!` after an explicit
      // length or guard check is the codebase-wide idiom for indexed access.
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Type declarations are optimistic about data crossing IPC and the Docker
      // API; the "unnecessary" guards are deliberate runtime defence.
      '@typescript-eslint/no-unnecessary-condition': 'off',
      // Interpolating numbers into template literals is intentional throughout
      // status strings and the UI.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // Async functions are passed directly as DOM/IPC event listeners across
      // the UI; the listener contract genuinely ignores the returned promise.
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { arguments: false } }],
      // `a || b` fallbacks here deliberately treat '' and 0 as absent.
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      // Async wrappers keep a Promise-returning contract even when the body is
      // currently synchronous.
      '@typescript-eslint/require-await': 'off',
      // `_`-prefixed bindings mark deliberately unused params kept for signature shape.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Concise arrows returning a void call (`() => cb()`, `(e) => push(e)`)
      // are the pervasive event-wiring idiom here; braces everywhere would be noise.
      '@typescript-eslint/no-confusing-void-expression': 'off',
      // tsconfig sets noPropertyAccessFromIndexSignature, so `process.env['X']`
      // bracket access is required by the compiler, not a style choice.
      '@typescript-eslint/dot-notation': ['error', { allowIndexSignaturePropertyAccess: true }],
      // Signal-backed record state (`busy`, `removeConfirm`) removes keys with
      // `delete` on a fresh copy — deliberate, not a Map candidate.
      '@typescript-eslint/no-dynamic-delete': 'off',
      // `() => {}` no-op callbacks are used as explicit "ignore this" handlers.
      '@typescript-eslint/no-empty-function': ['error', { allow: ['arrowFunctions'] }],
    },
  },

  // Tests exercise loosely-typed Docker fixtures; the assertions are the shape check.
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
);
