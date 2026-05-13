// git — real repos via isomorphic-git + IndexedDB; network GETs use proxy.js (like curl), POST is direct fetch (CORS).
import { gitHandler } from './git-handler.js';
import {
  DEFAULT_CHECKOUT_BATCH_LARGE,
  DEFAULT_CORS_PROXY,
  MAX_CHECKOUT_BATCH,
  MIN_CHECKOUT_BATCH,
  STORED_GIT_SETTING_KEYS,
  errResult,
  formatBytes,
  getStoredGitSetting,
  gitAuthor,
  parseCloneArgs,
  parseJshConfigArgs,
  resolveCheckoutBatchLarge,
  resolveCorsProxy,
  resolveGitCredential,
  setStoredGitSetting,
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
  DEFAULT_CHECKOUT_BATCH_LARGE,
  DEFAULT_CORS_PROXY,
  MAX_CHECKOUT_BATCH,
  MIN_CHECKOUT_BATCH,
  STORED_GIT_SETTING_KEYS,
  errResult,
  formatBytes,
  getStoredGitSetting,
  gitAuthor,
  parseCloneArgs,
  parseJshConfigArgs,
  resolveCheckoutBatchLarge,
  resolveCorsProxy,
  resolveGitCredential,
  setStoredGitSetting,
  takeFlagValue
};
