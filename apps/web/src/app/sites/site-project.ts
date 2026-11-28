import { validateWebsiteDocument } from "@cosmora/contracts/website-document";

/** Addressable multi-resource site project. Additive to the single-file v1 format. */
export const SITE_PROJECT_FORMAT = "kosmora.site-project.v1" as const;
export const SITE_PROJECT_MAX_BYTES = 512 * 1024;
export const SITE_BLOCK_MAX_BYTES = 64 * 1024;

export type SiteResource = {
  name: string;
  media_type: "image/png" | "image/jpeg" | "image/webp" | "text/plain";
  data_base64: string;
};
export type SiteBlock = {
  id: string;
  title: string;
  html: string;
};
export type SiteProject = {
  format: typeof SITE_PROJECT_FORMAT;
  title: string;
  blocks: SiteBlock[];
  resources: SiteResource[];
  html: string;
};

const NAME = /^[A-Za-z0-9._-]{1,80}$/;
const BLOCK_ID = /^[A-Za-z0-9_-]{1,60}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export function parseSiteProject(source: string): SiteProject {
  if (!source || new TextEncoder().encode(source).length > SITE_PROJECT_MAX_BYTES)
    throw Error("INVALID_SITE_PROJECT");
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw Error("INVALID_SITE_PROJECT");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("INVALID_SITE_PROJECT");
  const project = value as Partial<SiteProject>;
  if (
    project.format !== SITE_PROJECT_FORMAT ||
    typeof project.title !== "string" ||
    project.title.length > 120 ||
    !Array.isArray(project.blocks) ||
    project.blocks.length > 40 ||
    !Array.isArray(project.resources) ||
    project.resources.length > 32 ||
    typeof project.html !== "string"
  )
    throw Error("INVALID_SITE_PROJECT");
  if (new Set(project.blocks.map((block) => block.id)).size !== project.blocks.length)
    throw Error("INVALID_SITE_PROJECT");
  if (new Set(project.resources.map((resource) => resource.name)).size !== project.resources.length)
    throw Error("INVALID_SITE_PROJECT");
  for (const block of project.blocks) {
    if (
      !block ||
      typeof block.id !== "string" ||
      !BLOCK_ID.test(block.id) ||
      typeof block.title !== "string" ||
      block.title.length > 120 ||
      typeof block.html !== "string" ||
      new TextEncoder().encode(block.html).length > SITE_BLOCK_MAX_BYTES ||
      /<script(?:\s|>|\/)/i.test(block.html) ||
      /<iframe(?:\s|>|\/)/i.test(block.html) ||
      /<form(?:\s|>|\/)/i.test(block.html)
    )
      throw Error("INVALID_SITE_PROJECT");
  }
  const executable = /\.(exe|dll|so|dylib|msi|bat|cmd|ps1|sh|js)$/i;
  for (const resource of project.resources) {
    if (
      !resource ||
      typeof resource.name !== "string" ||
      !NAME.test(resource.name) ||
      executable.test(resource.name) ||
      !["image/png", "image/jpeg", "image/webp", "text/plain"].includes(resource.media_type) ||
      typeof resource.data_base64 !== "string" ||
      !BASE64.test(resource.data_base64) ||
      resource.data_base64.length % 4 !== 0 ||
      resource.data_base64.length > SITE_BLOCK_MAX_BYTES * 2
    )
      throw Error("INVALID_SITE_PROJECT");
  }
  // The rendered HTML must stay a valid static v1 document and never contain scripts.
  try {
    validateWebsiteDocument(project.html);
  } catch {
    throw Error("INVALID_SITE_PROJECT");
  }
  return project as SiteProject;
}

/** Change one block; all other blocks, resources and html stay byte-identical. */
export function editSiteBlock(source: string, id: string, value: { title: string; html: string }) {
  let project: SiteProject;
  try {
    project = parseSiteProject(source);
  } catch {
    return { ok: false as const, error: "INVALID_SITE_PROJECT" };
  }
  const index = project.blocks.findIndex((block) => block.id === id);
  if (index < 0) return { ok: false as const, error: "BLOCK_NOT_FOUND" };
  const blocks = project.blocks.map((block, i) => (i === index ? { ...block, ...value } : block));
  const json = JSON.stringify({ ...project, blocks }, null, 2);
  try {
    return { ok: true as const, json, project: parseSiteProject(json) };
  } catch {
    return { ok: false as const, error: "RESULT_INVALID" };
  }
}

/** Add or replace one linked resource without touching blocks or html. */
export function editSiteResource(source: string, resource: SiteResource) {
  let project: SiteProject;
  try {
    project = parseSiteProject(source);
  } catch {
    return { ok: false as const, error: "INVALID_SITE_PROJECT" };
  }
  const index = project.resources.findIndex((item) => item.name === resource.name);
  const resources =
    index < 0
      ? [...project.resources, resource]
      : project.resources.map((item, i) => (i === index ? resource : item));
  const json = JSON.stringify({ ...project, resources }, null, 2);
  try {
    return { ok: true as const, json, project: parseSiteProject(json) };
  } catch {
    return { ok: false as const, error: "RESULT_INVALID" };
  }
}
