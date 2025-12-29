// Shared Styles Loader - ES Module
// Loads component CSS and creates adoptable stylesheets for Shadow DOM

let sharedStyleSheet = null;
let styleSheetPromise = null;

/**
 * Loads the shared component stylesheet and returns a CSSStyleSheet
 * that can be adopted by Shadow DOM components
 */
export async function getSharedStyleSheet() {
  if (sharedStyleSheet) {
    return sharedStyleSheet;
  }

  if (styleSheetPromise) {
    return styleSheetPromise;
  }

  styleSheetPromise = (async () => {
    try {
      const response = await fetch(new URL('../css/components.css', import.meta.url));
      const cssText = await response.text();

      sharedStyleSheet = new CSSStyleSheet();
      await sharedStyleSheet.replace(cssText);

      return sharedStyleSheet;
    } catch (error) {
      console.error('Failed to load shared styles:', error);
      // Return an empty stylesheet as fallback
      sharedStyleSheet = new CSSStyleSheet();
      return sharedStyleSheet;
    }
  })();

  return styleSheetPromise;
}

/**
 * Adopts the shared stylesheet into a shadow root
 * @param {ShadowRoot} shadowRoot - The shadow root to adopt styles into
 */
export async function adoptSharedStyles(shadowRoot) {
  const sheet = await getSharedStyleSheet();
  shadowRoot.adoptedStyleSheets = [...shadowRoot.adoptedStyleSheets, sheet];
}

export default { getSharedStyleSheet, adoptSharedStyles };
