"use strict";

const ERROR_CODES = Object.freeze({
  WORKSPACE_ROOT_CHANGED: "WORKSPACE_ROOT_CHANGED",
  WORKSPACE_RESULT_UNCERTAIN: "WORKSPACE_RESULT_UNCERTAIN",
  WORKSPACE_BACKUP_UNAVAILABLE: "WORKSPACE_BACKUP_UNAVAILABLE",
  WORKSPACE_NOT_CONNECTED: "WORKSPACE_NOT_CONNECTED",
  WORKSPACE_OWNER_MISMATCH: "WORKSPACE_OWNER_MISMATCH",
  WORKSPACE_UNTRUSTED_CALLER: "WORKSPACE_UNTRUSTED_CALLER",
  WORKSPACE_UNSAFE_ROOT: "WORKSPACE_UNSAFE_ROOT",
  WORKSPACE_PATH_TRAVERSAL: "WORKSPACE_PATH_TRAVERSAL",
  WORKSPACE_SYMLINK_REJECTED: "WORKSPACE_SYMLINK_REJECTED",
  WORKSPACE_PROTECTED_PATH: "WORKSPACE_PROTECTED_PATH",
  WORKSPACE_FILE_TOO_LARGE: "WORKSPACE_FILE_TOO_LARGE",
  WORKSPACE_LIMIT_EXCEEDED: "WORKSPACE_LIMIT_EXCEEDED",
  WORKSPACE_BINARY_FILE: "WORKSPACE_BINARY_FILE",
  WORKSPACE_ALREADY_EXISTS: "WORKSPACE_ALREADY_EXISTS",
  WORKSPACE_NOT_FOUND: "WORKSPACE_NOT_FOUND",
  WORKSPACE_NOT_A_FILE: "WORKSPACE_NOT_A_FILE",
  WORKSPACE_NOT_A_DIRECTORY: "WORKSPACE_NOT_A_DIRECTORY",
  WORKSPACE_VERSION_CONFLICT: "WORKSPACE_VERSION_CONFLICT",
  WORKSPACE_OPERATION_CANCELLED: "WORKSPACE_OPERATION_CANCELLED",
  WORKSPACE_INVALID_ARGUMENT: "WORKSPACE_INVALID_ARGUMENT"
});

class KosworkWorkspaceError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "KosworkWorkspaceError";
    this.code = ERROR_CODES[code] || ERROR_CODES.WORKSPACE_INVALID_ARGUMENT;
    if (details && typeof details === "object") {
      this.details = Object.freeze({ ...details });
    }
  }
}

function throwIfAborted(signal, activeController) {
  if (signal?.aborted) {
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_OPERATION_CANCELLED,
      "Операция рабочей папки Koswork отменена.",
      { reason: typeof signal.reason === "string" ? signal.reason : "aborted" }
    );
  }
  if (activeController?.signal?.aborted) {
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_OPERATION_CANCELLED,
      "Операция прервана из-за отзыва доступа или отмены задач рабочей папки.",
      {
        reason:
          typeof activeController.signal.reason === "string"
            ? activeController.signal.reason
            : "revoked"
      }
    );
  }
}

module.exports = {
  ERROR_CODES,
  KosworkWorkspaceError,
  throwIfAborted
};
