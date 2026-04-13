/**
 * Minimal global `require` for dual browser / Node `-lib` modules without pulling in @types/node.
 * Browser builds never call it; Node tests use it to load peer `-lib` files.
 */
declare var require: ((id: string) => unknown) | undefined;
