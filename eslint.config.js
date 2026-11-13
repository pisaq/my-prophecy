// ESLint flat config — https://eslint.org/docs/latest/use/configure/
import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: ['dist/', 'node_modules/', 'public/models/', 'coverage/'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'no-param-reassign': ['error', { props: false }],
    },
  },
  {
    // Web worker
    files: ['src/audio/transcribe.worker.js', 'src/audio/worker-shim.js'],
    languageOptions: { globals: { ...globals.worker } },
  },
  {
    // Node tooling (build scripts, Vite config / plugin)
    files: ['scripts/**', 'vite.config.js', 'tooling/**', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.test.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  prettier,
];
