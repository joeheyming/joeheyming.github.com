/**
 * Clones dialog `<template>`s from `index.html` and appends them to `document.body`.
 * @returns {Record<string, HTMLElement>}
 */
export function injectDialogs() {
  const tplRename = document.getElementById('tpl-rename-dialog');
  const tplAddList = document.getElementById('tpl-add-list-dialog');
  const tplRemoveList = document.getElementById('tpl-remove-list-dialog');
  if (!tplRename?.content || !tplAddList?.content || !tplRemoveList?.content) {
    throw new Error(
      'Missing dialog templates (tpl-rename-dialog, tpl-add-list-dialog, tpl-remove-list-dialog).'
    );
  }

  const renameDialog = /** @type {HTMLDialogElement} */ (
    tplRename.content.firstElementChild.cloneNode(true)
  );
  const addListDialog = /** @type {HTMLDialogElement} */ (
    tplAddList.content.firstElementChild.cloneNode(true)
  );
  const removeListDialog = /** @type {HTMLDialogElement} */ (
    tplRemoveList.content.firstElementChild.cloneNode(true)
  );
  document.body.append(renameDialog, addListDialog, removeListDialog);

  return {
    renameDialog,
    renameInput: /** @type {HTMLInputElement} */ (
      renameDialog.querySelector('#rename-dialog-input')
    ),
    renameBtnOk: renameDialog.querySelector('[data-rename="ok"]'),
    renameBtnCancel: renameDialog.querySelector('[data-rename="cancel"]'),
    addListDialog,
    listPromptMessage: /** @type {HTMLParagraphElement} */ (
      addListDialog.querySelector('#add-list-prompt-message')
    ),
    listNameInput: /** @type {HTMLInputElement} */ (
      addListDialog.querySelector('#add-list-prompt-input')
    ),
    listAddBtnOk: /** @type {HTMLButtonElement} */ (
      addListDialog.querySelector('[data-add-list="ok"]')
    ),
    listAddBtnCancel: addListDialog.querySelector('[data-add-list="cancel"]'),
    removeListDialog,
    removeListNameEl: /** @type {HTMLElement} */ (
      removeListDialog.querySelector('#remove-list-name')
    ),
    removeListBtnOk: removeListDialog.querySelector('[data-remove-list="ok"]'),
    removeListBtnCancel: removeListDialog.querySelector('[data-remove-list="cancel"]')
  };
}

/** @param {HTMLDialogElement} dialog */
export function wireBackdropClose(dialog) {
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      dialog.close();
    }
  });
}
