"use client";
import { fieldRegisterCsv, type FieldRow } from "@cosmora/core";

/** BIZ-040: download-ready CSV for the extracted field register. The caller
 * (Codex wiring) supplies rows produced by extractFieldRegister(). */
export function createFieldRegisterCsvBlob(rows: readonly FieldRow[]): Blob {
  return new Blob([fieldRegisterCsv(rows)], { type: "text/csv;charset=utf-8" });
}
