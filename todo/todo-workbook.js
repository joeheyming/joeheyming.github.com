import {
  initGoogleAuth,
  isOAuthUserCancelledError,
  requestAccessToken,
  getCachedAccessToken,
  getStoredSpreadsheetId,
  waitForGoogle
} from '../google-db/google-auth.js';
import { openSiteDatabase } from '../google-db/site-database.js';
import { createGoogleSheetClient } from './todo-sheets.js';
import {
  DEFAULT_FULL_SHEET_TITLE,
  TODO_TAB_PREFIX,
  displayNameFromFullTitle,
  getEffectiveSheetName,
  saveStoredTabName
} from './todo-constants.js';
import { setStatus } from './todo-ui.js';

/**
 * If `localStorage` has no workbook id, Drive may still list a file created earlier with this app (`drive.file`).
 * @param {{ id: string, name: string }[]} candidates
 * @returns {Promise<'create' | string>}
 */
export async function resolveUncachedWorkbook(candidates) {
  const title = candidates[0]?.name ?? 'spreadsheet';
  if (candidates.length === 1) {
    const ok = globalThis.confirm(
      `Found an existing “${title}” from this site in your Google account.\n\nReconnect to it instead of creating a new spreadsheet?`
    );
    return ok ? candidates[0].id : 'create';
  }
  const ok = globalThis.confirm(
    `Found ${candidates.length} spreadsheets named “${title}”.\n\nOK = use the most recently updated one. Cancel = create a new spreadsheet.`
  );
  return ok ? candidates[0].id : 'create';
}

/**
 * @param {{
 *   state: {
 *     client: ReturnType<typeof createGoogleSheetClient> | null,
 *     siteDb: import('../google-db/site-database.js').SiteDatabase | null,
 *     tabSelectSilence: boolean
 *   },
 *   statusEl: HTMLElement,
 *   sheetTabSelect: HTMLSelectElement,
 *   todoList: HTMLElement,
 *   setAppLoading: (loading: boolean, message?: string) => void,
 *   setAppLoadingMessage: (text: string) => void,
 *   setConnectedUi: (connected: boolean) => void,
 *   getRefreshTodos: () => () => Promise<void>
 * }} deps
 */
export function createWorkbookConnection(deps) {
  const {
    state,
    statusEl,
    sheetTabSelect,
    todoList,
    setAppLoading,
    setAppLoadingMessage,
    setConnectedUi,
    getRefreshTodos
  } = deps;

  async function getAccessToken() {
    let t = getCachedAccessToken();
    if (t) {
      return t;
    }
    await requestAccessToken({ prompt: '' });
    t = getCachedAccessToken();
    if (!t) {
      throw new Error('No access token');
    }
    return t;
  }

  /**
   * @param {string | undefined} preferredTitle
   */
  async function populateTabSelect(preferredTitle) {
    if (!state.siteDb) {
      return preferredTitle || getEffectiveSheetName();
    }
    let tabs = await state.siteDb.listTables();
    let todoTabs = tabs.filter((tab) => tab.title.startsWith(TODO_TAB_PREFIX));
    if (todoTabs.length === 0) {
      await state.siteDb.createTable(DEFAULT_FULL_SHEET_TITLE);
      tabs = await state.siteDb.listTables();
      todoTabs = tabs.filter((tab) => tab.title.startsWith(TODO_TAB_PREFIX));
    }
    state.tabSelectSilence = true;
    sheetTabSelect.replaceChildren();
    for (const tab of todoTabs) {
      const opt = document.createElement('option');
      opt.value = tab.title;
      opt.textContent = displayNameFromFullTitle(tab.title);
      opt.dataset.sheetId = String(tab.sheetId);
      sheetTabSelect.appendChild(opt);
    }
    const want = (preferredTitle || '').trim() || getEffectiveSheetName();
    let chosen = want;
    if (![...sheetTabSelect.options].some((o) => o.value === want)) {
      chosen = sheetTabSelect.options[0]?.value || want;
    }
    sheetTabSelect.value = chosen;
    state.tabSelectSilence = false;
    return chosen;
  }

  /**
   * @param {string | null | undefined} preferredTab
   * @param {{ silent?: boolean, showLoadingUi?: boolean }} [opts]
   */
  async function connectToSheet(preferredTab, opts = {}) {
    const { silent = false, showLoadingUi = false } = opts;
    if (showLoadingUi) {
      setStatus(statusEl, '');
      setAppLoading(true, 'Connecting to Google…');
    }
    try {
      await waitForGoogle();
      initGoogleAuth();
      let token = getCachedAccessToken();
      if (!token) {
        if (silent) {
          const storedWorkbookId = getStoredSpreadsheetId();
          if (storedWorkbookId) {
            try {
              await requestAccessToken({ prompt: '' });
              token = getCachedAccessToken();
            } catch (e) {
              if (!isOAuthUserCancelledError(e)) {
                console.log('[todo] Silent token refresh failed', e);
              }
            }
          }
          if (!token) {
            setConnectedUi(false);
            setStatus(statusEl, '');
            return;
          }
        } else {
          await getAccessToken();
          token = getCachedAccessToken();
          if (!token) {
            throw new Error('No access token');
          }
        }
      }

      state.siteDb = null;

      const opened = await openSiteDatabase({
        getAccessToken,
        initialTables: [DEFAULT_FULL_SHEET_TITLE],
        silent,
        onWillCreateWorkbook: () => {
          setStatus(statusEl, 'Setting up your data…');
          if (showLoadingUi) {
            setAppLoadingMessage('Setting up your spreadsheet…');
          }
        },
        resolveUncachedWorkbook: silent ? undefined : resolveUncachedWorkbook
      });
      if (opened === null) {
        setConnectedUi(false);
        setStatus(statusEl, '');
        return;
      }
      const { db, created } = opened;
      state.siteDb = db;
      if (created) {
        await db.writeRange(DEFAULT_FULL_SHEET_TITLE, 'A1:D1', [
          ['id', 'title', 'done', 'createdAt']
        ]);
      }
      setStatus(statusEl, '');

      const tabName = await populateTabSelect(
        preferredTab != null && preferredTab !== '' ? String(preferredTab) : getEffectiveSheetName()
      );
      state.client = createGoogleSheetClient({
        db,
        sheetName: tabName
      });
      saveStoredTabName(tabName);
      await getRefreshTodos()();
      if (showLoadingUi) {
        setAppLoading(false);
      }
      setConnectedUi(true);
      setStatus(statusEl, '');
      console.log('[todo] Connected', {
        workbookId: db.workbookId,
        sheetName: tabName,
        todoRows: todoList.querySelectorAll('li').length,
        silent
      });
    } finally {
      if (showLoadingUi) {
        setAppLoading(false);
      }
    }
  }

  async function tryAutoConnect() {
    try {
      await connectToSheet(null, { silent: true, showLoadingUi: true });
    } catch (e) {
      if (isOAuthUserCancelledError(e)) {
        state.client = null;
        state.siteDb = null;
        setConnectedUi(false);
        setStatus(statusEl, '');
        return;
      }
      console.log('[todo] Auto-connect failed', e);
      state.client = null;
      state.siteDb = null;
      setConnectedUi(false);
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(
        statusEl,
        msg || 'Could not connect automatically. Use “Sign in with Google” or check config.',
        true
      );
    }
  }

  return { connectToSheet, tryAutoConnect, populateTabSelect, getAccessToken };
}
