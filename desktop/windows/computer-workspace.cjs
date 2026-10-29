"use strict";
const fs = require("node:fs");
const path = require("node:path");
const {
  createKosworkWorkspaceService,
  createBackupStore,
  resolveSafeWorkspaceTarget
} = require("./workspace/index.cjs");

function createComputerWorkspace({ userDataPath, codec, pickDirectory, scopeNamespace = "" }) {
  if (!codec?.seal || !codec?.open) throw Error("COMPUTER_WORKSPACE_UNAVAILABLE");
  const service = createKosworkWorkspaceService({
    userDataPath,
    codec,
    requireOwnerScope: true,
    pickDirectory,
    scopeNamespace
  });
  let scope = null;
  const owner = (context) => ({ ownerId: context.owner, origin: context.origin });
  function snapshot(context) {
    if (!scope) return null;
    if (scope.owner !== context.owner || scope.origin !== context.origin)
      throw Error("COMPUTER_IDENTITY_CHANGED");
    const state = service.getStatus(owner(context));
    return { id: state.workspaceId, name: state.rootName.slice(0, 180) };
  }
  function invalidate() {
    service.cancelAllOperations("native_scope_closed");
    const prior = scope;
    scope = null;
    return prior ? service.revokeAccess(owner(prior)) : Promise.resolve();
  }
  return {
    uploadFile(context, workspaceId, relativePath) {
      if (snapshot(context)?.id !== workspaceId || !workspaceId)
        throw Error("COMPUTER_WORKSPACE_CHANGED");
      const status = service.getStatus(owner(context));
      const file = resolveSafeWorkspaceTarget(status.rootPath, relativePath, { mustExist: true });
      if (!file.stat.isFile() || file.stat.size > 25 * 1024 * 1024)
        throw Error("BROWSER_FILE_TOO_LARGE");
      return file.absolutePath;
    },
    reserveDownload(context, workspaceId, filename) {
      if (snapshot(context)?.id !== workspaceId || !workspaceId)
        throw Error("COMPUTER_WORKSPACE_CHANGED");
      const status = service.getStatus(owner(context));
      const name =
        path.win32
          .basename(String(filename))
          .replace(/[<>:"|?*\u0000-\u001f\u007f]/gu, "_")
          .replace(/[ .]+$/u, "")
          .slice(0, 150) || "download.bin";
      const extension = path.extname(name),
        stem = name.slice(0, name.length - extension.length);
      for (let i = 0; i < 100; i++) {
        const candidate = i ? stem + " (" + i + ")" + extension : name;
        const target = resolveSafeWorkspaceTarget(status.rootPath, candidate, {
          allowMissingLeaf: true
        });
        if (target.exists) continue;
        try {
          const fd = fs.openSync(target.absolutePath, "wx", 0o600);
          fs.closeSync(fd);
          return { name: candidate, path: target.absolutePath };
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
        }
      }
      throw Error("BROWSER_DOWNLOAD_UNAVAILABLE");
    },
    verifyDownload(context, workspaceId, file, size) {
      if (snapshot(context)?.id !== workspaceId || !workspaceId)
        throw Error("COMPUTER_WORKSPACE_CHANGED");
      const status = service.getStatus(owner(context));
      const target = resolveSafeWorkspaceTarget(
        status.rootPath,
        path.relative(status.rootPath, file),
        { mustExist: true }
      );
      if (!target.stat.isFile() || target.stat.size !== size || size > 25 * 1024 * 1024)
        throw Error("BROWSER_DOWNLOAD_UNAVAILABLE");
    },
    snapshot,
    async connect(context, signal) {
      await invalidate();
      const value = await service.connectFolder({ ...owner(context), signal });
      scope = { ...context };
      return { id: value.workspaceId, name: value.rootName.slice(0, 180) };
    },
    invalidate,
    cancel: () => service.cancelAllOperations("native_stop"),
    forget() {
      void invalidate();
      const directory = path.resolve(userDataPath, "koswork-backups");
      try {
        const stat = fs.lstatSync(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink())
          throw Error("COMPUTER_WORKSPACE_UNAVAILABLE");
        for (const name of fs.readdirSync(directory))
          if (/^[a-f0-9]{24}$/.test(name))
            createBackupStore(path.join(directory, name), { codec }).purgeAll();
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    },
    async execute(action, { context, workspaceId, signal }) {
      if (!workspaceId || snapshot(context)?.id !== workspaceId)
        throw Error("COMPUTER_WORKSPACE_CHANGED");
      const args = { ...owner(context), signal, relativePath: action.path };
      let result;
      switch (action.kind) {
        case "workspace_list":
          result = await service.listFiles({
            ...args,
            recursive: false,
            maxEntries: 30,
            cursor: action.cursor
          });
          break;
        case "workspace_find":
          result = await service[action.mode === "text" ? "searchByText" : "searchByName"]({
            ...args,
            query: action.query,
            maxResults: 15
          });
          break;
        case "workspace_read":
          result = await service.readTextFile({ ...args, maxBytes: 10000 });
          break;
        case "workspace_mkdir":
          result = await service.createDirectory(args);
          break;
        case "workspace_create":
          result = await service.createFile({ ...args, content: action.content });
          break;
        case "workspace_update":
          result = await service.updateFile({
            ...args,
            content: action.content,
            expectedVersion: action.expected_version
          });
          break;
        case "workspace_backups":
          result = { backups: service.listBackups({ ...args }) };
          break;
        case "workspace_restore":
          result = await service.restoreBackup({
            ...args,
            backupId: action.backup_id,
            expectedVersion: action.expected_version
          });
          break;
        default:
          throw Error("COMPUTER_ACTION_INVALID");
      }
      if (signal.aborted) throw Error("COMPUTER_SESSION_STOPPED");
      if (snapshot(context)?.id !== workspaceId) throw Error("COMPUTER_WORKSPACE_CHANGED");
      delete result.rootPath;
      if (JSON.stringify(result).length > 15000)
        return {
          error: "WORKSPACE_RESULT_TOO_LARGE",
          instruction:
            "Narrow the query or request a smaller file. No partial JSON or file content is returned."
        };
      return result;
    }
  };
}
module.exports = { createComputerWorkspace };
