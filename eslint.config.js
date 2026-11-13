// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  ...expoConfig,
  {
    ignores: [
      'android/**',
      'ios/**',
      'dist/**',
      'web-build/**',
      '.expo/**',
      'web-static/**',
      'web-check/**',
    ],
  },
  {
    rules: {
      // Experimental compiler rules: Firestore subscription effects set
      // loading state synchronously, and document timestamps read the
      // clock during render. Both patterns are correct here.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
    },
  },
]);
