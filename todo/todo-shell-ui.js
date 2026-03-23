import { getStoredSpreadsheetId } from '../google-db/google-auth.js';
import {
  getAppLoadingEl,
  getAppLoadingMessageEl,
  getAuthCardEl,
  getSignedOutBodyEl,
  getSignedOutEmptyEl,
  getSignedOutTitleEl,
  getTodoAppRoot,
  getTodoPanelEl
} from './todo-dom.js';

/**
 * Loading overlay, signed-out card copy, and connected vs disconnected layout.
 * Resolves DOM nodes via {@link ./todo-dom.js} each time `createShellUi` runs.
 */
export function createShellUi() {
  const todoAppRoot = getTodoAppRoot();
  const appLoadingEl = getAppLoadingEl();
  const appLoadingMessageEl = getAppLoadingMessageEl();
  const signedOutEmpty = getSignedOutEmptyEl();
  const authCard = getAuthCardEl();
  const todoPanel = getTodoPanelEl();
  const signedOutTitleEl = getSignedOutTitleEl();
  const signedOutBodyEl = getSignedOutBodyEl();

  function setAppLoadingMessage(text) {
    if (appLoadingMessageEl && typeof text === 'string') {
      appLoadingMessageEl.textContent = text;
    }
  }

  function setAppLoading(loading, message) {
    if (!appLoadingEl) {
      return;
    }
    if (loading) {
      const text =
        typeof message === 'string' && message.trim() !== ''
          ? message.trim()
          : 'Connecting to Google…';
      setAppLoadingMessage(text);
      appLoadingEl.hidden = false;
      todoAppRoot?.setAttribute('aria-busy', 'true');
      if (signedOutEmpty) {
        signedOutEmpty.hidden = true;
      }
      if (todoPanel) {
        todoPanel.hidden = true;
      }
      if (authCard) {
        authCard.hidden = true;
      }
    } else {
      appLoadingEl.hidden = true;
      todoAppRoot?.setAttribute('aria-busy', 'false');
    }
  }

  function refreshSignedOutEmptyCopy() {
    const hasWorkbook = getStoredSpreadsheetId().length > 0;
    if (signedOutTitleEl) {
      signedOutTitleEl.textContent = hasWorkbook ? 'Sign in to reconnect' : 'You’re signed out';
    }
    if (signedOutBodyEl) {
      signedOutBodyEl.textContent = hasWorkbook
        ? 'This browser has a saved spreadsheet link. Sign in with Google to open it and load your lists.'
        : 'Sign in with Google to open your spreadsheet and load your lists.';
    }
    if (signedOutEmpty) {
      signedOutEmpty.setAttribute(
        'aria-label',
        hasWorkbook ? 'Reconnect to spreadsheet' : 'Signed out'
      );
    }
  }

  function setConnectedUi(connected) {
    if (!connected) {
      refreshSignedOutEmptyCopy();
    }
    if (signedOutEmpty) {
      signedOutEmpty.hidden = connected;
    }
    if (todoPanel) {
      todoPanel.hidden = !connected;
    }
    if (authCard) {
      authCard.hidden = !connected;
    }
  }

  return { setAppLoadingMessage, setAppLoading, refreshSignedOutEmptyCopy, setConnectedUi };
}
