import importX from 'eslint-plugin-import-x';
import tsParser from '@typescript-eslint/parser';

// The /sim package is the simulation core and must remain renderer/UI-agnostic.
// CLAUDE.md: "/sim cannot import from /render, /ui, /audio, or /app. Lint-enforce this."
const SIM_FORBIDDEN_FROM = ['./render', './ui', './audio', './app'];

export default [
  {
    ignores: ['dist/**', 'node_modules/**', '.vite/**'],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      'import-x': importX,
    },
    settings: {
      'import-x/resolver': {
        typescript: { project: './tsconfig.json' },
        node: true,
      },
    },
    rules: {
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: SIM_FORBIDDEN_FROM.map((from) => ({
            target: './sim',
            from,
            message: `/sim is the simulation core and may not import from ${from} (see CLAUDE.md "Hard architectural rules").`,
          })),
        },
      ],
    },
  },
];
