import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import importPlugin from 'eslint-plugin-import'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/drizzle/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,

  {
    plugins: { import: importPlugin },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },

  // ---------------------------------------------------------------------------
  // Règles de dépendance entre paquets — voir docs/adr/0001-monolithe-modulaire.md
  //
  // Le moteur de barème doit rester pur. S'il pouvait lire la base, appeler le
  // réseau ou consulter l'horloge, il cesserait d'être reproductible — et la
  // reproductibilité est ce qui rend une note défendable devant un jury.
  // ---------------------------------------------------------------------------
  {
    files: ['packages/grading/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@coteris/database',
                '@coteris/ai',
                '@coteris/auth',
                '@coteris/audit',
                '@coteris/ui',
                'drizzle-orm',
                'postgres',
                'node:fs',
                'node:http',
                'node:https',
                'fs',
                'http',
                'https',
              ],
              message:
                'packages/grading doit rester pur : aucune I/O, aucune base, aucun réseau. ' +
                'Passez les données nécessaires en paramètres.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Aucun appel réseau dans le moteur de barème.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message:
            'Le moteur de barème ne lit pas l’horloge. Passez la date en paramètre ' +
            'pour que le calcul reste reproductible.',
        },
        {
          selector: "MemberExpression[object.name='Date'][property.name='now']",
          message: 'Le moteur de barème ne lit pas l’horloge. Passez la date en paramètre.',
        },
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message: 'Le moteur de barème doit être déterministe.',
        },
      ],
    },
  },

  {
    files: ['packages/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@coteris/*'],
              message: 'packages/shared est la feuille du graphe : il ne dépend d’aucun paquet.',
            },
          ],
        },
      ],
    },
  },

  // Points d'entrée en ligne de commande : leur sortie console EST leur
  // interface. Un opérateur qui applique une migration doit voir ce qui se passe.
  {
    files: [
      '**/src/migrate.ts',
      '**/src/reset.ts',
      '**/src/cli/**/*.ts',
      'packages/seed/**/*.ts',
      'scripts/**/*.ts',
      // Le worker n'a pas d'interface : sa sortie console EST son journal.
      'apps/worker/**/*.ts',
    ],
    rules: {
      'no-console': 'off',
    },
  },

  {
    files: ['**/*.test.ts', '**/*.spec.ts', 'tests/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-restricted-syntax': 'off',
    },
  },
)
