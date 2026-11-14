import type { ProjectContextItem } from "@cosmora/core";
import type { ProjectStore, ProjectMemoryStore, GeneralChatStore } from "@cosmora/db";

const MAX_ITEMS = 8;
const MAX_TEXT = 600;
const clip = (text: string): string => text.trim().slice(0, MAX_TEXT);

/** Project agreements/materials for a NEW chat of this project.
 *
 * Only data explicitly stored for this project is used. Private (confidential)
 * chats are excluded in both directions: their agreements never enter another
 * chat, and they never receive project context. Every item carries its source.
 */
export function projectChatContext(
  chatId: string,
  ownerId: string,
  stores: {
    chats: GeneralChatStore;
    projects: ProjectStore;
    memory: ProjectMemoryStore;
  }
): ProjectContextItem[] {
  const chat = stores.chats.getChat(chatId, ownerId);
  if (!chat || !chat.project_id || chat.confidential) return [];
  const projectId = chat.project_id;
  if (!stores.projects.getProject(projectId, ownerId)) return [];
  const items: ProjectContextItem[] = [];

  const materials = stores.projects.getMaterials(projectId, ownerId);
  if (materials?.instructions.trim())
    items.push({
      text: clip(materials.instructions),
      source: `материалы проекта / инструкции v${materials.version}`
    });
  for (const attachment of materials?.attachments ?? [])
    items.push({
      text: clip(`${attachment.name}: ${attachment.content}`),
      source: `материалы проекта / файл ${attachment.name}`
    });

  // Явные записи памяти проекта: закреплённые первыми. Источник — из записи.
  for (const entry of stores.memory.list(projectId, ownerId).slice(0, MAX_ITEMS)) {
    items.push({
      text: clip(`${entry.title}: ${entry.content}`),
      source: `память проекта / ${entry.source.kind}: ${entry.source.reference}`
    });
  }

  // Договорённости из ДРУГИХ чатов проекта (не конфиденциальных): последние
  // сообщения пользователя с явной ссылкой на чат-источник.
  const siblings = stores.chats
    .listChats(ownerId, false, projectId)
    .filter((sibling) => sibling.id !== chatId);
  for (const sibling of siblings.slice(0, MAX_ITEMS)) {
    const detail = stores.chats.getChat(sibling.id, ownerId);
    if (!detail || detail.confidential) continue;
    const last = stores.chats
      .listMessages(sibling.id, ownerId)
      .filter((message) => message.role === "user" && message.content.trim())
      .at(-1);
    if (last)
      items.push({
        text: clip(last.content),
        source: `чат проекта «${sibling.title}» (${sibling.id})`
      });
  }
  return items.slice(0, MAX_ITEMS);
}
