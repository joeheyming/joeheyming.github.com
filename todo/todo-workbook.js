import {
  initGoogleAuth,
  isOAuthUserCancelledError,
  requestAccessToken,
  getCachedAccessToken,
  getStoredSpreadsheetId,
  waitForGoogle
} from '../google-db/google-auth.js';
import { openSiteDatabase, SiteDatabase } from '../google-db/site-database.js';
import { createGoogleSheetClient } from './todo-sheets.js';
import {
  DEFAULT_FULL_SHEET_TITLE,
  TODO_TAB_PREFIX,
  displayNameFromFullTitle,
  getEffectiveSheetName,
  getEffectiveListSpreadsheetId,
  loadStoredListSpreadsheetId,
  openedListValue,
  saveStoredListSpreadsheetId,
  saveStoredTabName,
  sheetTitleFromListValue
} from './todo-constants.js';
import { readExternalListEntries } from './todo-manifest.js';
import { loadOpenedSharedEntries } from './todo-opened-shared.js';
import { setStatus } from './todo-ui.js';

/**
 * @param {HTMLOptionElement} opt
 * @param {string} mainWorkbookId
 * @returns {string}
 */
function optionWorkbookId(opt, mainWorkbookId) {
  const d = (opt.dataset.spreadsheetId || '').trim();
  return d || mainWorkbookId;
}

/**
 * @param {HTMLSelectElement} sheetTabSelect
 * @param {string} wantValue
 * @param {string} mainWorkbookId
 */
function selectMatchingOption(sheetTabSelect, wantValue, mainWorkbookId) {
  const want = wantValue.trim();
  const wantWbRaw = loadStoredListSpreadsheetId();
  const opts = [...sheetTabSelect.options];

  if (wantWbRaw) {
    const wantWbResolved = wantWbRaw;
    const found = opts.find(
      (o) =>
        o.value === want &&
        optionWorkbookId(/** @type {HTMLOptionElement} */ (o), mainWorkbookId) === wantWbResolved
    );
    if (found) {
      sheetTabSelect.value = found.value;
      return;
    }
  }

  const sameValue = opts.filter((o) => o.value === want);
  if (sameValue.length === 1) {
    sheetTabSelect.value = sameValue[0].value;
    return;
  }

  if (want.startsWith('opened:')) {
    const found = opts.find((o) => o.value === want);
    if (found) {
      sheetTabSelect.value = found.value;
      return;
    }
  }

  if (opts[0]) {
    sheetTabSelect.value = opts[0].value;
  }
}

/**
 * @param {{
 *   siteDb: import('../google-db/site-database.js').SiteDatabase,
 *   listValue: string,
 *   getAccessToken: () => Promise<string>
 * }} opts
 * @returns {ReturnType<typeof createGoogleSheetClient>}
 */
export function createListClient(opts) {
  const { siteDb, listValue, getAccessToken } = opts;
  const mainId = siteDb.workbookId;
  const sheetTitle = sheetTitleFromListValue(listValue);
  const wid = getEffectiveListSpreadsheetId(mainId);
  const listDb = wid === mainId ? siteDb : new SiteDatabase(wid, getAccessToken);
  return createGoogleSheetClient({ db: listDb, sheetName: sheetTitle });
}

/**
 * If `localStorage` has no workbook id, Drive may still list a file created with this app (`drive.file`).
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
    const mainId = state.siteDb.workbookId;
    let tabs = await state.siteDb.listTables();
    let todoTabs = tabs.filter((tab) => tab.title.startsWith(TODO_TAB_PREFIX));
    if (todoTabs.length === 0) {
      await state.siteDb.createTable(DEFAULT_FULL_SHEET_TITLE);
      tabs = await state.siteDb.listTables();
      todoTabs = tabs.filter((tab) => tab.title.startsWith(TODO_TAB_PREFIX));
    }

    const external = await readExternalListEntries(state.siteDb);
    const mainTitles = new Set(todoTabs.map((t) => t.title));
    const opened = loadOpenedSharedEntries();

    state.tabSelectSilence = true;
    sheetTabSelect.replaceChildren();

    for (const tab of todoTabs) {
      const opt = document.createElement('option');
      opt.value = tab.title;
      opt.textContent = displayNameFromFullTitle(tab.title);
      opt.dataset.sheetId = String(tab.sheetId);
      opt.dataset.listOrigin = 'main';
      opt.dataset.spreadsheetId = '';
      sheetTabSelect.appendChild(opt);
    }

    for (const ex of external) {
      if (mainTitles.has(ex.fullTabTitle)) {
        continue;
      }
      const opt = document.createElement('option');
      opt.value = ex.fullTabTitle;
      opt.textContent = displayNameFromFullTitle(ex.fullTabTitle);
      opt.dataset.listOrigin = 'manifest';
      opt.dataset.spreadsheetId = ex.spreadsheetId;
      opt.dataset.sheetTitle = ex.sheetTitle;
      opt.dataset.sheetId = '';
      sheetTabSelect.appendChild(opt);
    }

    for (const o of opened) {
      const opt = document.createElement('option');
      opt.value = openedListValue(o.spreadsheetId, o.sheetTitle);
      opt.textContent = `${displayNameFromFullTitle(o.sheetTitle)} (shared)`;
      opt.dataset.listOrigin = 'opened';
      opt.dataset.spreadsheetId = o.spreadsheetId;
      opt.dataset.sheetTitle = o.sheetTitle;
      opt.dataset.sheetId = '';
      sheetTabSelect.appendChild(opt);
    }

    const want = (preferredTitle || '').trim() || getEffectiveSheetName();
    selectMatchingOption(sheetTabSelect, want, mainId);

    const chosen = sheetTabSelect.value;
    state.tabSelectSilence = false;
    return chosen;
  }

  function applySelectionToClient(listValue) {
    if (!state.siteDb) {
      return;
    }
    const opt = sheetTabSelect.selectedOptions[0];
    saveStoredListSpreadsheetId((opt?.dataset.spreadsheetId || '').trim());
    state.client = createListClient({
      siteDb: state.siteDb,
      listValue,
      getAccessToken
    });
    saveStoredTabName(listValue);
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

      const openResult = await openSiteDatabase({
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
      if (openResult === null) {
        setConnectedUi(false);
        setStatus(statusEl, '');
        return;
      }
      const { db, created } = openResult;
      state.siteDb = db;
      if (created) {
        await db.writeRange(DEFAULT_FULL_SHEET_TITLE, 'A1:D1', [
          ['id', 'title', 'done', 'createdAt']
        ]);
      }
      setStatus(statusEl, '');

      const listValue = await populateTabSelect(
        preferredTab != null && preferredTab !== '' ? String(preferredTab) : getEffectiveSheetName()
      );
      applySelectionToClient(listValue);
      await getRefreshTodos()();
      if (showLoadingUi) {
        setAppLoading(false);
      }
      setConnectedUi(true);
      setStatus(statusEl, '');
      const opt = sheetTabSelect.selectedOptions[0];
      console.log('[todo] Connected', {
        workbookId: db.workbookId,
        listValue,
        listSpreadsheetId: (opt?.dataset.spreadsheetId || '').trim() || db.workbookId,
        sheetTitle: sheetTitleFromListValue(listValue),
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

  return {
    connectToSheet,
    tryAutoConnect,
    populateTabSelect,
    getAccessToken,
    applySelectionToClient
  };
}
