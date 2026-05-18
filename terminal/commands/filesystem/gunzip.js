// gunzip — alias for `gzip -d`.
import gzip from './gzip.js';
import { makeHandler } from './gzip.js';

export default {
  name: 'gunzip',
  handler: makeHandler(true),
  description: 'decompress .gz files via pako',
  category: 'File System'
};
