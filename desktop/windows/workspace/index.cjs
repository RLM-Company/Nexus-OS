"use strict";

const { ERROR_CODES, KosworkWorkspaceError, throwIfAborted } = require("./errors.cjs");
const {
  DEFAULT_IGNORED_DIRS,
  PROTECTED_TOP_SEGMENTS,
  RESERVED_WINDOWS_NAMES,
  assertNotReparseOrSymlink,
  inspectRootDirectory,
  isForbiddenSystemRoot,
  isPathInsideOrEqual,
  isPathStrictlyInside,
  isSensitiveFilename,
  normalizeForComparison,
  resolveSafeWorkspaceTarget,
  validateRelativePath
} = require("./path-guard.cjs");
const {
  computeBufferVersion,
  createBackupStore,
  decodeStrictUtf8Text,
  normalizeExpectedSha256,
  readBoundedFileSnapshot,
  versionsMatch
} = require("./version-backup.cjs");
const {
  DEFAULT_LIMITS,
  assertNotRemoteWebCaller,
  createKosworkWorkspaceService,
  sanitizeLimits
} = require("./workspace-service.cjs");

module.exports = {
  DEFAULT_IGNORED_DIRS,
  DEFAULT_LIMITS,
  ERROR_CODES,
  KosworkWorkspaceError,
  PROTECTED_TOP_SEGMENTS,
  RESERVED_WINDOWS_NAMES,
  assertNotRemoteWebCaller,
  assertNotReparseOrSymlink,
  computeBufferVersion,
  createBackupStore,
  createKosworkWorkspaceService,
  decodeStrictUtf8Text,
  inspectRootDirectory,
  isForbiddenSystemRoot,
  isPathInsideOrEqual,
  isPathStrictlyInside,
  isSensitiveFilename,
  normalizeExpectedSha256,
  normalizeForComparison,
  readBoundedFileSnapshot,
  resolveSafeWorkspaceTarget,
  sanitizeLimits,
  throwIfAborted,
  validateRelativePath,
  versionsMatch
};
