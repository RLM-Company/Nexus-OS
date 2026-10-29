"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createKosworkWorkspaceService, createBackupStore } = require("./workspace/index.cjs");

function createComputerWorkspace({ userDataPath, codec, pickDirectory }) {
  if (!codec?.seal || !codec?.open) throw Error("COMPUTER_WORKSPACE_UNAVAILABLE");
  const service = createKosworkWorkspaceService({
    userDataPath,
    codec,
    requireOwnerScope: true,
    pickDirectory
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
