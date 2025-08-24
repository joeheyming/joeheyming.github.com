module.exports = {
  env: {
    browser: true,
    node: true,
    es2021: true
  },
  globals: {
    analytics: 'writable',
    dataLayer: 'writable',
    gtag: 'writable'
  },
  extends: ['eslint:recommended', 'prettier'],
  plugins: ['prettier'],
  parserOptions: {
    ecmaVersion: 'latest'
  },
  rules: {
    // todo: remove
    'no-undef': 'off',
    'no-unused-vars': 'off',
    'prettier/prettier': 'error'
  }
};
