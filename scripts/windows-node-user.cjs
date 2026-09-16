// Loaded before ESM hooks, including in Node's loader worker. tsx uses
// process.geteuid only to namespace its temporary directory.
if (process.platform === "win32" && typeof process.geteuid !== "function") {
  Object.defineProperty(process, "geteuid", {
    configurable: true,
    value: () => 0
  });
}
