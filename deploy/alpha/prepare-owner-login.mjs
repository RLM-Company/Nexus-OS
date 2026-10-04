import { readFileSync, writeFileSync } from "node:fs";
import { hashOwnerPassword } from "./owner-access.mjs";

const password = readFileSync("/run/cosmora/owner-password", "utf8").replace(/\r?\n$/u, "");
if (password.length < 16 || password.length > 512) throw new Error("Owner password length invalid");
writeFileSync(
  "/run/cosmora/owner-login.env",
  `COSMORA_OWNER_PASSWORD_HASH=${hashOwnerPassword(password)}\n`,
  { mode: 0o600, flag: "wx" }
);
console.log("Existing owner password prepared for form login; no credential changed.");
