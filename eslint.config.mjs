// Regeln nach xitavis-next (apps/api, apps/web); Projektspezifisches (Modulgrenzen, vue-i18n) fehlt bewusst.
import { fileURLToPath } from 'node:url';
import { globalIgnores } from 'eslint/config';
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript';
import pluginVue from 'eslint-plugin-vue';
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting';

const typescriptRules = {
  // Routen-Plugins sind async per Fastify-Konvention, auch ohne await.
  '@typescript-eslint/require-await': 'off',
  '@typescript-eslint/no-unused-vars': [
    'error',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
  ],
  '@typescript-eslint/consistent-type-imports': 'error',
  // Kein `as` außer `as const`; Ausnahmen brauchen ein eslint-disable mit Begründung.
  '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
  '@typescript-eslint/switch-exhaustiveness-check': [
    'error',
    { considerDefaultExhaustiveForUnions: true },
  ],
  '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
  // `value || null` macht aus leeren Eingaben bewusst `null`.
  '@typescript-eslint/prefer-nullish-coalescing': [
    'error',
    { ignorePrimitives: { string: true, number: true } },
  ],
  // Nach dmmulroy/anti-slop: Werte mit bekanntem Typ nicht zu `unknown` verbreitern, Abhängigkeiten nicht wegmocken.
  'no-restricted-syntax': [
    'error',
    {
      // Ausgenommen: das Subjekt eines Type-Guards und Fehlerparameter (`error`, `cause`).
      selector:
        ":function:not([returnType.typeAnnotation.type='TSTypePredicate']) > Identifier.params[name!=/^(error|cause)$/] > TSTypeAnnotation > TSUnknownKeyword, :function > AssignmentPattern.params > Identifier.left > TSTypeAnnotation > TSUnknownKeyword",
      message:
        'Kein `unknown`-Parameter; den echten Typ annehmen oder am Rand mit Zod/Type-Guard prüfen.',
    },
    {
      // Generic-Constraints (`T extends Record<string, unknown>`) bleiben erlaubt.
      selector:
        "TSTypeAnnotation > TSTypeReference[typeName.name='Record'] > TSTypeParameterInstantiation > :matches(TSUnknownKeyword, TSObjectKeyword), TSIndexSignature > TSTypeAnnotation > :matches(TSUnknownKeyword, TSObjectKeyword)",
      message:
        'Kein offenes Dictionary (`Record<string, unknown>`); konkreten Typ, `satisfies` oder `Partial<…>` verwenden.',
    },
    {
      selector:
        "CallExpression > MemberExpression.callee:matches([object.name=/^(vi|jest)$/][property.name=/^(mock|doMock|unstable_mockModule)$/], [property.name='module']:matches([object.name='mock'], [object.property.name='mock']))",
      message:
        'Kein Modul-Mocking; die Abhängigkeit als Parameter oder Plugin übergeben und im Test echt ersetzen.',
    },
  ],
};

const vueRules = {
  'vue/block-order': ['error', { order: ['script', 'template', 'style'] }],
  'vue/multi-word-component-names': 'off',
  // Vue-3-Stil, den `flat/recommended` nicht abdeckt.
  'vue/component-api-style': ['error', ['script-setup']],
  'vue/component-name-in-template-casing': ['error', 'PascalCase'],
  'vue/no-undef-components': ['error', { ignorePatterns: ['RouterLink', 'RouterView'] }],
  'vue/no-unused-emit-declarations': 'error',
  'vue/no-unused-refs': 'error',
  'vue/no-useless-mustaches': 'error',
  'vue/no-useless-v-bind': 'error',
  'vue/no-v-html': 'error',
  'vue/prefer-true-attribute-shorthand': 'error',
  'vue/define-macros-order': [
    'error',
    { order: ['defineProps', 'defineModel', 'defineEmits', 'defineSlots'] },
  ],
  'vue/html-button-has-type': 'error',
  'vue/prefer-use-template-ref': 'error',
  'vue/require-explicit-slots': 'error',
  // Reaktivität: Props und Refs nicht im Setup-Wurzelbereich „auspacken“.
  'vue/define-props-destructuring': 'error',
  'vue/no-ref-object-reactivity-loss': 'error',
  'vue/no-setup-props-reactivity-loss': 'error',
  'vue/no-unused-properties': 'error',
  'vue/require-macro-variable-name': 'error',
  'vue/require-typed-object-prop': 'error',
  'vue/require-typed-ref': 'error',
  'vue/block-lang': ['error', { script: { lang: 'ts' } }],
  'vue/no-duplicate-attr-inheritance': 'error',
  'vue/no-empty-component-block': 'error',
  'vue/no-import-compiler-macros': 'error',
  'vue/prefer-define-options': 'error',
  // Template
  'vue/custom-event-name-casing': 'error',
  'vue/no-implicit-coercion': 'error',
  'vue/no-literals-in-template': 'error',
  'vue/no-multiple-objects-in-class': 'error',
  'vue/no-negated-v-if-condition': 'error',
  'vue/no-static-inline-styles': 'error',
  'vue/no-template-target-blank': 'error',
  'vue/no-undef-directives': 'error',
  'vue/no-use-v-else-with-v-for': 'error',
  'vue/no-v-text': 'error',
  'vue/prefer-v-model': 'error',
  'vue/slot-name-casing': 'error',
  // Kernregeln, die ESLint selbst nur im <script> prüft.
  'vue/eqeqeq': 'error',
  'vue/no-console': 'error',
  'vue/no-constant-condition': 'error',
  'vue/no-useless-concat': 'error',
  'vue/object-shorthand': 'error',
  'vue/prefer-template': 'error',
  // Die typescript-eslint-Regeln sehen nur `<script>`; das hier gilt im Template.
  'vue/no-restricted-syntax': [
    'error',
    {
      selector: "VElement TSAsExpression:not([typeAnnotation.typeName.name='const'])",
      message: 'Kein `as` im Template; Typ im <script> klären.',
    },
    {
      selector: 'VElement TSNonNullExpression',
      message: 'Kein `!` im Template; Wert im <script> prüfen.',
    },
    // Logik gehört ins <script>: das Template bindet nur Werte und ruft Handler auf.
    {
      selector:
        "VElement > VExpressionContainer ArrowFunctionExpression, VAttribute[directive=true][key.name.name!='on'] ArrowFunctionExpression",
      message:
        'Keine Callbacks (map/filter/…) im Template; als computed oder Funktion ins <script>.',
    },
    {
      selector:
        "VOnExpression[body.length>1], VAttribute[key.name.name='on'] ArrowFunctionExpression > BlockStatement",
      message: 'Handler mit mehreren Anweisungen als Funktion ins <script>.',
    },
    {
      selector: 'VElement ConditionalExpression ConditionalExpression',
      message: 'Kein verschachteltes `?:` im Template; ins <script>.',
    },
    {
      selector: 'VElement NewExpression',
      message: 'Kein `new` im Template; Wert im <script> berechnen.',
    },
  ],
  // Optionale Props sind über den Typ (`?`) schon eindeutig.
  'vue/require-default-prop': 'off',
  'vue/define-props-declaration': ['error', 'type-based'],
  'vue/define-emits-declaration': ['error', 'type-literal'],
};

export default defineConfigWithVueTs(
  { name: 'app/files-to-lint', files: ['**/*.{ts,mts,vue}'] },
  globalIgnores([
    '**/dist/**',
    '**/node_modules/**',
    '**/coverage/**',
    '**/*.config.*',
    'scripts/**',
  ]),
  pluginVue.configs['flat/recommended'],
  vueTsConfigs.strictTypeChecked,
  vueTsConfigs.stylisticTypeChecked,
  skipFormatting,
  {
    // Ohne festes Wurzelverzeichnis rät typescript-eslint im Monorepo falsch.
    languageOptions: {
      parserOptions: { tsconfigRootDir: fileURLToPath(new URL('.', import.meta.url)) },
    },
    rules: typescriptRules,
  },
  { files: ['apps/frontend/**/*.{ts,vue}'], rules: vueRules },
  {
    files: ['apps/api/test/**/*.ts'],
    rules: { '@typescript-eslint/no-floating-promises': 'off' },
  },
  {
    // Tests, Seed und Playtest arbeiten mit Daten, die sie selbst angelegt haben.
    files: ['apps/api/test/**/*.ts', 'apps/api/src/lib/seed.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    // ESLint kennt den Typparameter aus `<script generic>` nicht und hält `<T>` für den Default.
    files: ['**/*.vue'],
    rules: { '@typescript-eslint/no-unnecessary-type-arguments': 'off' },
  }
);
