import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';
import vuePlugin from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';

const typescript = {
  files: ['**/*.ts'],
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },
  plugins: {
    '@typescript-eslint': tsPlugin,
  },
  rules: {
    ...tsPlugin.configs.recommended.rules,
    'no-undef': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
  },
};

export default [
  { ignores: ['**/dist/**', '**/node_modules/**', '**/*.config.*'] },
  js.configs.recommended,
  typescript,
  ...vuePlugin.configs['flat/recommended'],
  {
    ...typescript,
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tsParser,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      ...typescript.rules,
      'vue/attributes-order': 'off',
      'vue/require-default-prop': 'off',
    },
  },
  prettier,
];
