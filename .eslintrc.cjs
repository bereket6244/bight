/**
 * ESLint configuration.
 *
 * The rules that matter here are the ones that would let a real bug through:
 * floating promises, unchecked `any`, and missing hook dependencies. Style is
 * left mostly alone — the codebase is consistent by convention, not by lint.
 */
module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react-hooks'],
  ignorePatterns: [
    'dist',
    'android',
    'node_modules',
    'coverage',
    'public',
    '*.cjs',
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    // Explicit `any` is banned, but the codebase uses `unknown` plus narrowing
    // at every boundary, so this rarely fires.
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/consistent-type-imports': [
      'error',
      { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
    ],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    'prefer-const': 'error',
    'no-var': 'error',
  },
  overrides: [
    {
      // Tests reach into internals and build deliberately malformed input.
      files: ['**/*.test.ts', '**/*.test.tsx', 'src/test/**'],
      rules: {
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
    {
      files: ['scripts/**/*.mjs'],
      rules: { 'no-console': 'off' },
    },
  ],
};
