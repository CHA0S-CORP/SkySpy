module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  extends: ['eslint:recommended', 'plugin:react/recommended', 'plugin:react/jsx-runtime', 'plugin:react-hooks/recommended', 'plugin:jsx-a11y/recommended', 'plugin:storybook/recommended'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: ['react', 'react-hooks', 'jsx-a11y'],
  settings: {
    react: {
      version: 'detect',
    },
  },
  rules: {
    // React rules
    'react/prop-types': 'off',
    'react/jsx-no-target-blank': 'warn',
    'react/jsx-key': 'warn',
    'react/no-unescaped-entities': 'warn',

    // React Hooks rules
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'off', // Too many false positives with complex hooks

    // General rules - ignore React and common unused patterns
    'no-unused-vars': [
      'warn',
      {
        argsIgnorePattern: '^_|^(props|options|config|apiBase|index|event|err|error)$',
        varsIgnorePattern: '^(_|React$|set[A-Z])',
        ignoreRestSiblings: true,
      },
    ],
    'no-console': 'off', // Allow console for debugging aviation data
    'prefer-const': 'warn',
    'no-var': 'error',
    'eqeqeq': ['warn', 'always', { null: 'ignore' }],

    // Accessibility rules (jsx-a11y)
    'jsx-a11y/alt-text': 'error',
    'jsx-a11y/anchor-has-content': 'error',
    'jsx-a11y/click-events-have-key-events': 'error',
    'jsx-a11y/interactive-supports-focus': 'error',
    'jsx-a11y/label-has-associated-control': 'error',
    'jsx-a11y/no-static-element-interactions': 'warn',
  },
  ignorePatterns: [
    'dist',
    'build',
    'node_modules',
    'playwright-report',
    'test-results',
    '*.config.js',
    '*.config.cjs',
  ],
};
