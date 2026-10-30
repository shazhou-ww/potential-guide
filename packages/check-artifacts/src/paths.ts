export const artifactLimits = Object.freeze({
  bytes: 64 * 1024 * 1024,
  files: 256,
  paths: 512,
  archiveBytes: 72 * 1024 * 1024,
  expandedTarBytes: 66 * 1024 * 1024,
});
export function safeComponent(name: string): boolean {
  return (
    !!name &&
    name !== "." &&
    name !== ".." &&
    name === name.normalize("NFC") &&
    Buffer.byteLength(name) <= 255 &&
    name.toLowerCase() !== "node_modules" &&
    !/[\\:<>"|?*]/.test(name) &&
    ![...name].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) &&
    !/[. ]$/.test(name) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
  );
}
export function safePath(path: string): boolean {
  return Buffer.byteLength(path) <= 1024 && path.split("/").every(safeComponent);
}
