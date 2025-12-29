/**
 * Creates a Proxy that auto-delegates method/property access to a singleton instance.
 *
 * Usage:
 *   class MyComponentElement extends HTMLElement {
 *     static get() { return document.getElementById('my-component'); }
 *     // ... methods
 *   }
 *   customElements.define('my-component', MyComponentElement);
 *   export const MyComponent = createComponentProxy(MyComponentElement);
 *
 * Then consumers can call:
 *   MyComponent.someMethod()  // instead of MyComponent.get()?.someMethod()
 *
 * @param {typeof HTMLElement} ElementClass - The web component class with a static get() method
 * @returns {Proxy} A proxy that delegates to the singleton instance
 */
export function createComponentProxy(ElementClass) {
  return new Proxy(ElementClass, {
    get(target, prop) {
      // Static properties/methods on the class itself
      if (prop in target) {
        return target[prop];
      }
      // Delegate to the singleton instance
      const instance = target.get();
      if (instance && prop in instance) {
        const value = instance[prop];
        return typeof value === 'function' ? value.bind(instance) : value;
      }
      return undefined;
    }
  });
}
