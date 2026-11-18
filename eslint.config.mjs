import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';

const require = createRequire(import.meta.url);
const legacy = require('./.eslintrc.js');
const compat = new FlatCompat({
  baseDirectory: path.dirname(fileURLToPath(import.meta.url)),
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all
});

export default [
  {
    ignores: [
      '**/*min.js',
      'speakGenerator.js',
      'badapple/frame/**',
      'pacman/Executable/**',
      'pacman/Source/**',
      'doom/src/doom.js'
    ]
  },
  ...compat.config(legacy),
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'off'
    }
  }
];
