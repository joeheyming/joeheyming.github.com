// Shared Styles Loader - ES Module
// Loads component CSS and creates adoptable stylesheets for Shadow DOM

let sharedStyleSheet = null;
let styleSheetPromise = null;

// The shared sheet is split into per-component partials. They're fetched
// in parallel and concatenated before being handed to CSSStyleSheet.replace()
// — @import isn't an option because constructable stylesheets strip it.
const COMPONENT_PARTIALS = [
  '../css/components/difficulty-selector.css',
  '../css/components/zenius-browser.css',
  '../css/components/step-button.css',
  '../css/components/game-over.css',
  '../css/components/simfile-badges.css',
];

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
      const texts = await Promise.all(
        COMPONENT_PARTIALS.map(async (path) => {
          const response = await fetch(new URL(path, import.meta.url));
          return response.text();
        }),
      );
      const cssText = texts.join('\n');

      sharedStyleSheet = new CSSStyleSheet();
      await sharedStyleSheet.replace(cssText);

      return sharedStyleSheet;
    } catch (error) {
      console.error('Failed to load shared styles:', error);
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
