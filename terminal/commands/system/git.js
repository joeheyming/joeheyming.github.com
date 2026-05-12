// git — real repos via isomorphic-git + IndexedDB; network GETs use proxy.js (like curl), POST is direct fetch (CORS).
import { gitHandler } from './git-handler.js';
import {
  errResult,
  formatBytes,
  gitAuthor,
  resolveCorsProxy,
  resolveGitCredential,
  takeFlagValue
} from './git-utils.js';

export default {
  name: 'git',
  handler: gitHandler,
  description:
    'distributed version control (isomorphic-git + IndexedDB; GET via proxy when available)',
  category: 'System'
};

export const _testExports = {
  formatBytes,
  takeFlagValue,
  errResult,
  resolveCorsProxy,
  resolveGitCredential,
  gitAuthor
};
