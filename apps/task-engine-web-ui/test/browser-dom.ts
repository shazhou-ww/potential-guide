import { JSDOM } from "jsdom";

export function browserDom(html: string) {
  const dom = new JSDOM(html, { url: "http://ui.fixture", pretendToBeVisual: true });
  const { window } = dom;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const values: Record<string, unknown> = {
    window,
    document: window.document,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  };
  for (const key of [
    "Node",
    "NodeFilter",
    "Element",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLSelectElement",
    "HTMLTextAreaElement",
    "HTMLButtonElement",
    "Document",
    "DocumentFragment",
    "SVGElement",
    "MutationObserver",
    "Event",
    "CustomEvent",
    "KeyboardEvent",
    "MouseEvent",
    "FocusEvent",
    "Option",
  ])
    values[key] = Reflect.get(window, key);
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  window.HTMLElement.prototype.scrollIntoView = () => {};
  return {
    window,
    document: window.document,
    async restore() {
      await new Promise((resolve) => setTimeout(resolve, 30));
      window.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}
