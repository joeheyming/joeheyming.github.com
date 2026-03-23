/**
 * Clones dialog `<template>`s from `index.html` and appends them to `document.body`.
 * @returns {Record<string, HTMLElement>}
 */
export function injectDialogs() {
  const tplRename = document.getElementById('tpl-rename-dialog');
  const tplAddList = document.getElementById('tpl-add-list-dialog');
  const tplRemoveList = document.getElementById('tpl-remove-list-dialog');
  const tplShareList = document.getElementById('tpl-share-list-dialog');
  const tplOpenShared = document.getElementById('tpl-open-shared-dialog');
  if (
    !tplRename?.content ||
    !tplAddList?.content ||
    !tplRemoveList?.content ||
    !tplShareList?.content ||
    !tplOpenShared?.content
  ) {
    throw new Error('Missing dialog templates in index.html.');
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
  const shareListDialog = /** @type {HTMLDialogElement} */ (
    tplShareList.content.firstElementChild.cloneNode(true)
  );
  const openSharedDialog = /** @type {HTMLDialogElement} */ (
    tplOpenShared.content.firstElementChild.cloneNode(true)
  );
  document.body.append(
    renameDialog,
    addListDialog,
    removeListDialog,
    shareListDialog,
    openSharedDialog
  );

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
    removeListDetailEl: /** @type {HTMLParagraphElement} */ (
      removeListDialog.querySelector('#remove-list-detail')
    ),
    removeListBtnOk: removeListDialog.querySelector('[data-remove-list="ok"]'),
    removeListBtnCancel: removeListDialog.querySelector('[data-remove-list="cancel"]'),
    shareListDialog,
    shareEmailsInput: /** @type {HTMLTextAreaElement} */ (
      shareListDialog.querySelector('#share-list-emails-input')
    ),
    shareListBtnOk: shareListDialog.querySelector('[data-share-list="ok"]'),
    shareListBtnCancel: shareListDialog.querySelector('[data-share-list="cancel"]'),
    openSharedDialog,
    openSharedInput: /** @type {HTMLInputElement} */ (
      openSharedDialog.querySelector('#open-shared-input')
    ),
    openSharedBtnOk: openSharedDialog.querySelector('[data-open-shared="ok"]'),
    openSharedBtnCancel: openSharedDialog.querySelector('[data-open-shared="cancel"]')
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
