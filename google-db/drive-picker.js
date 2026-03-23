/**
 * Google Picker — lets the user grant `drive.file` access to one spreadsheet.
 * Requires `https://apis.google.com/js/api.js` on the page and a browser API key.
 */

/**
 * @returns {Promise<void>}
 */
export function loadPickerApi() {
  return new Promise((resolve, reject) => {
    const g = globalThis.gapi;
    if (!g?.load) {
      reject(new Error('Load https://apis.google.com/js/api.js before using the Picker'));
      return;
    }
    const timer = setTimeout(() => reject(new Error('Google Picker load timed out')), 45_000);
    try {
      g.load('picker', () => {
        clearTimeout(timer);
        resolve();
      });
    } catch (e) {
      clearTimeout(timer);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/**
 * Opens a spreadsheet-only picker so the user grants `drive.file` access to one file.
 *
 * @param {{ developerKey: string, accessToken: string, title?: string }} opts
 * @returns {Promise<string | null>} Drive file id, or `null` if cancelled
 */
export function openSpreadsheetPicker(opts) {
  const { developerKey, accessToken, title } = opts;
  const googlePicker = globalThis.google?.picker;
  if (!googlePicker) {
    return Promise.reject(new Error('Picker API not loaded'));
  }

  return new Promise((resolve) => {
    new googlePicker.PickerBuilder()
      .addView(googlePicker.ViewId.SPREADSHEETS)
      .setOAuthToken(accessToken)
      .setDeveloperKey(developerKey)
      .setTitle(title || 'Select the spreadsheet for this app')
      .setCallback((data) => {
        const action = data[googlePicker.Response.ACTION];
        if (action === googlePicker.Action.PICKED) {
          const docs = data[googlePicker.Response.DOCUMENTS];
          const id = docs?.[0]?.[googlePicker.Document.ID];
          resolve(id ? String(id) : null);
          return;
        }
        resolve(null);
      })
      .build()
      .setVisible(true);
  });
}
