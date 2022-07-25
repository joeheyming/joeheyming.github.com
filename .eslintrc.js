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
    'prettier/prettier': [
      'error',
      {
        singleQuote: true,
        printWidth: 100,
        trailingComma: 'es5',
        semi: true,
        tabWidth: 2,
        arrowParens: 'always',
        htmlWhitespaceSensitivity: 'ignore',
        trailingComma: 'none'
      }
    ]
  }
};
