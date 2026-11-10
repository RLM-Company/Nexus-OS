"use strict";
const { randomBytes } = require("node:crypto");
const { inspectOffice, editOffice } = require("./office-edit.cjs");
const { validateRelativePath } = require("./path-guard.cjs");
const { ERROR_CODES, KosworkWorkspaceError } = require("./errors.cjs");
const conflict = () => {
  throw new KosworkWorkspaceError(
    ERROR_CODES.WORKSPACE_VERSION_CONFLICT,
    "Документ или план изменился. Откройте документ и подготовьте новый preview."
  );
};
// Ephemeral proposals only; files, grants, versions and writes remain in workspace-service.
function createOfficeWorkspace({ read, create, identity }) {
  const plans = new Map();
  const checkVersion = (snapshot, expected) => {
    if (!/^sha256:[a-f0-9]{64}$/.test(expected) || snapshot.version !== expected) conflict();
  };
  return {
    clear() {
      plans.clear();
    },
    inspect(options) {
      const snapshot = read(options);
      if (
        options.expectedVersion != null ||
        options.cursor?.target_offset > 0 ||
        options.cursor?.content_offset > 0
      )
        checkVersion(snapshot, options.expectedVersion);
      return inspectOffice(options.relativePath, snapshot.buffer, {
        cursor: options.cursor,
        expectedVersion: options.expectedVersion ?? null,
        path: options.relativePath
      });
    },
    preview(options) {
      for (const file of [options.relativePath, options.outputPath]) {
        if (validateRelativePath(file).segments[0].toLowerCase() === ".kosmora-vault")
          throw new KosworkWorkspaceError(
            ERROR_CODES.WORKSPACE_PROTECTED_PATH,
            "Виртуальное хранилище доступно только для чтения."
          );
      }
      if (
        options.outputPath.toLowerCase() === options.relativePath.toLowerCase() ||
        !/\.(docx|xlsx|pptx)$/i.test(options.relativePath) ||
        options.outputPath.split(".").at(-1).toLowerCase() !==
          options.relativePath.split(".").at(-1).toLowerCase()
      )
        throw Error("WORKSPACE_OFFICE_INVALID");
      const snapshot = read(options);
      checkVersion(snapshot, options.expectedVersion);
      const result = editOffice(options.relativePath, snapshot.buffer, options.operations);
      if (Buffer.byteLength(JSON.stringify(result.diff)) > 10000)
        throw Error("WORKSPACE_OFFICE_VIEW_LIMIT");
      const id = randomBytes(16).toString("hex");
      for (const [key, value] of plans) if (value.expires < Date.now()) plans.delete(key);
      if (plans.size >= 8) plans.delete(plans.keys().next().value);
      inspectOffice(options.outputPath, result.buffer);
      // Snapshot nested operation values as well as metadata. Neither a caller's
      // input objects nor a returned preview may alter the approved transaction.
      const receipt = structuredClone({
        plan_id: id,
        path: options.relativePath,
        output_path: options.outputPath,
        source_version: snapshot.version,
        proposed_version: result.version,
        sha256: result.sha256,
        diff: result.diff,
        rejected_changes: [],
        representation: result.representation
      });
      if (Buffer.byteLength(JSON.stringify(receipt)) > 14000)
        throw Error("WORKSPACE_OFFICE_VIEW_LIMIT");
      plans.set(id, {
        receipt,
        buffer: result.buffer,
        identity: identity(options),
        expires: Date.now() + 10 * 60 * 1000
      });
      return structuredClone(receipt);
    },
    describe(options) {
      const plan = plans.get(options.planId);
      if (
        !plan ||
        plan.expires < Date.now() ||
        plan.identity !== identity(options) ||
        options.relativePath !== plan.receipt.path ||
        options.expectedVersion !== plan.receipt.source_version
      )
        conflict();
      checkVersion(read(options), options.expectedVersion);
      return structuredClone(plan.receipt);
    },
    async commit(options) {
      const plan = plans.get(options.planId);
      if (
        !plan ||
        plan.expires < Date.now() ||
        plan.identity !== identity(options) ||
        options.relativePath !== plan.receipt.path ||
        options.expectedVersion !== plan.receipt.source_version
      )
        conflict();
      // Consume once, including on errors. A cancelled/failed write needs a fresh preview.
      plans.delete(options.planId);
      const recheck = () => {
        if (plan.identity !== identity(options)) conflict();
        checkVersion(read(options), options.expectedVersion);
      };
      recheck();
      const saved = await create({
        ...options,
        relativePath: plan.receipt.output_path,
        buffer: plan.buffer,
        _beforeWriteCheck: recheck
      });
      const reread = read({ ...options, relativePath: saved.path });
      if (reread.version !== plan.receipt.proposed_version)
        throw Error("WORKSPACE_RESULT_UNCERTAIN");
      return {
        ...saved,
        source_version: plan.receipt.source_version,
        executed_changes: plan.receipt.diff,
        rejected_changes: [],
        readback: {
          version: reread.version,
          sha256: reread.sha256,
          representation: inspectOffice(saved.path, reread.buffer).representation,
          verified: true,
          content_not_included: true
        },
        next_read_required: true
      };
    }
  };
}
module.exports = { createOfficeWorkspace };
