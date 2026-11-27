import { createHash } from "node:crypto";
import type { ManagerWork, MemoryUsageSnapshot, UsedSource } from "@cosmora/contracts";
import { supplierWorkInput } from "./supplier-work-input.js";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

function input(id: string, label: string, hash: string, version: number | null = null): UsedSource {
  return {
    label,
    reference: "work-input:" + id,
    kind: "input",
    source_kind: "work_input",
    source_id: id,
    sha256: hash,
    version,
    quote: "",
    excerpt_only: false
  };
}

export function supplierWorkSources(work: ManagerWork): UsedSource[] {
  const source = work.supplier_handoff;
  const canonical = input(work.id, "Вход расчёта поставщиков", sha256(supplierWorkInput(work)));
  const answer = work.supplier_clarification?.answer;
  const clarification = answer
    ? [input(work.id + ":answer", "Уточнение владельца", sha256(answer))]
    : [];
  if (!source)
    return [
      ...(answer
        ? [input(work.id + ":original", "Исходные данные", sha256(work.request.goal))]
        : []),
      ...clarification,
      canonical
    ];
  if (source.inputs.length)
    return [
      ...source.inputs.map((file, index) =>
        input(source.message_id + ":" + source.attachment_indexes[index], file.name, file.sha256)
      ),
      ...clarification,
      canonical
    ];
  return [
    {
      ...canonical,
      label: "Сообщение Kosmora",
      sha256: sha256(work.request.goal),
      reference: "chat-message:" + source.message_id,
      kind: "history",
      source_kind: "chat_message",
      source_id: source.message_id
    },
    ...clarification,
    ...(answer ? [canonical] : [])
  ];
}

export function modelWorkSources(work: ManagerWork, snapshot: MemoryUsageSnapshot): UsedSource[] {
  const materials = work.materials;
  const version = materials?.version || null;
  const sources: UsedSource[] = [];
  if (materials?.instructions)
    sources.push(
      input(
        work.project_id + ":instructions",
        "Инструкции проекта",
        sha256(materials.instructions),
        version
      )
    );
  materials?.attachments.forEach((file, index) =>
    sources.push(
      input(work.project_id + ":material:" + index, file.name, sha256(file.content), version)
    )
  );
  if (snapshot.representation === "exact")
    for (const item of snapshot.sources.slice(0, 128 - sources.length))
      sources.push({
        reference: item.reference,
        kind: item.kind,
        source_kind: item.source_kind ?? "memory_entry",
        source_id: item.source_message_id ?? item.reference.slice(0, 128),
        version: item.version,
        sha256: item.source_sha256 ?? item.text_sha256,
        // A source reference and hash prove provenance without retaining a second copy of its text.
        quote: "",
        excerpt_only: item.excerpt_only
      });
  return sources;
}
