/** Stable `#id`s for `todo/index.html` — single source of truth for layout hooks. */

export const IDS = {
  todoAppRoot: 'todo-app-root',
  appLoading: 'app-loading',
  appLoadingMessage: 'app-loading-message',
  signedOutEmpty: 'signed-out-empty',
  signedOutTitle: 'signed-out-empty-title',
  signedOutBody: 'signed-out-empty-body',
  authCard: 'auth-card',
  todoPanel: 'todo-panel',
  status: 'status',
  btnSignin: 'btn-signin',
  btnSignout: 'btn-signout',
  sheetTabSelect: 'sheet-tab-select',
  btnOpenAddList: 'btn-open-add-list',
  btnRemoveList: 'btn-remove-list',
  btnOpenRename: 'btn-open-rename',
  btnOpenShareList: 'btn-open-share-list',
  btnOpenAddShared: 'btn-open-add-shared',
  newTitle: 'new-title',
  btnAdd: 'btn-add',
  todoList: 'todo-list',
  todoEmpty: 'todo-empty',
  newTodoForm: 'new-todo-form'
};

/** @returns {HTMLElement | null} */
export function getTodoAppRoot() {
  return document.getElementById(IDS.todoAppRoot);
}

/** @returns {HTMLElement | null} */
export function getAppLoadingEl() {
  return document.getElementById(IDS.appLoading);
}

/** @returns {HTMLElement | null} */
export function getAppLoadingMessageEl() {
  return document.getElementById(IDS.appLoadingMessage);
}

/** @returns {HTMLElement | null} */
export function getSignedOutEmptyEl() {
  return document.getElementById(IDS.signedOutEmpty);
}

/** @returns {HTMLElement | null} */
export function getSignedOutTitleEl() {
  return document.getElementById(IDS.signedOutTitle);
}

/** @returns {HTMLElement | null} */
export function getSignedOutBodyEl() {
  return document.getElementById(IDS.signedOutBody);
}

/** @returns {HTMLElement | null} */
export function getAuthCardEl() {
  return document.getElementById(IDS.authCard);
}

/** @returns {HTMLElement | null} */
export function getTodoPanelEl() {
  return document.getElementById(IDS.todoPanel);
}

/** @returns {HTMLElement | null} */
export function getStatusEl() {
  return document.getElementById(IDS.status);
}

/** @returns {HTMLElement | null} */
export function getBtnSignin() {
  return document.getElementById(IDS.btnSignin);
}

/** @returns {HTMLElement | null} */
export function getBtnSignout() {
  return document.getElementById(IDS.btnSignout);
}

/** @returns {HTMLSelectElement | null} */
export function getSheetTabSelectEl() {
  return /** @type {HTMLSelectElement | null} */ (document.getElementById(IDS.sheetTabSelect));
}

/** @returns {HTMLElement | null} */
export function getBtnOpenAddList() {
  return document.getElementById(IDS.btnOpenAddList);
}

/** @returns {HTMLElement | null} */
export function getBtnRemoveList() {
  return document.getElementById(IDS.btnRemoveList);
}

/** @returns {HTMLElement | null} */
export function getBtnOpenRename() {
  return document.getElementById(IDS.btnOpenRename);
}

/** @returns {HTMLElement | null} */
export function getBtnOpenShareList() {
  return document.getElementById(IDS.btnOpenShareList);
}

/** @returns {HTMLElement | null} */
export function getBtnOpenAddShared() {
  return document.getElementById(IDS.btnOpenAddShared);
}

/** @returns {HTMLInputElement | null} */
export function getNewTitleInput() {
  return /** @type {HTMLInputElement | null} */ (document.getElementById(IDS.newTitle));
}

/** @returns {HTMLButtonElement | null} */
export function getBtnAdd() {
  return /** @type {HTMLButtonElement | null} */ (document.getElementById(IDS.btnAdd));
}

/** @returns {HTMLElement | null} */
export function getTodoListEl() {
  return document.getElementById(IDS.todoList);
}

/** @returns {HTMLElement | null} */
export function getTodoEmptyEl() {
  return document.getElementById(IDS.todoEmpty);
}

/** @returns {HTMLFormElement | null} */
export function getNewTodoFormEl() {
  return /** @type {HTMLFormElement | null} */ (document.getElementById(IDS.newTodoForm));
}
