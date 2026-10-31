const activations = new WeakMap<HTMLElement, number>();
export function claimActivation(
  control: HTMLElement,
  minimumInterval: number,
  now = performance.now(),
): boolean {
  const previous = activations.get(control);
  if (previous !== undefined && now - previous < minimumInterval) return false;
  activations.set(control, now);
  return true;
}

/** Reconcile keyed view nodes without detaching focused controls or open disclosures. */
export function reconcile(parent: Node, desired: readonly Node[]): void {
  const existing = [...parent.childNodes];
  const used = new Set<Node>();
  const key = (node: Node) =>
    node.nodeType === 1 ? (node as Element).getAttribute("data-key") : null;
  for (const [index, next] of desired.entries()) {
    const identity = key(next);
    const previous = identity
      ? existing.find(
          (item) => !used.has(item) && key(item) === identity && item.nodeName === next.nodeName,
        )
      : existing.find(
          (item) =>
            !used.has(item) &&
            !key(item) &&
            item.nodeType === next.nodeType &&
            item.nodeName === next.nodeName,
        );
    const target = previous ?? next;
    used.add(target);
    if (previous && previous !== next) {
      if (previous.nodeType === 1) {
        const element = previous as HTMLElement;
        const candidate = next as HTMLElement;
        const preserve = (name: string) =>
          (element.tagName === "DETAILS" && name === "open") ||
          name === "data-busy" ||
          (element.dataset.busy === "true" && name === "disabled");
        for (const attribute of [...element.attributes])
          if (!preserve(attribute.name) && !candidate.hasAttribute(attribute.name))
            element.removeAttribute(attribute.name);
        for (const attribute of [...candidate.attributes])
          if (!preserve(attribute.name) && element.getAttribute(attribute.name) !== attribute.value)
            element.setAttribute(attribute.name, attribute.value);
        element.onclick = candidate.onclick;
        reconcile(element, [...candidate.childNodes]);
      } else if (previous.nodeValue !== next.nodeValue) previous.nodeValue = next.nodeValue;
    }
    const position = parent.childNodes[index];
    if (position !== target) parent.insertBefore(target, position ?? null);
  }
  for (const child of existing) if (!used.has(child)) parent.removeChild(child);
}
