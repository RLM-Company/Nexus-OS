import { randomUUID } from "node:crypto";
import { TypeBoxValidatorCompiler } from "@fastify/type-provider-typebox";
import type { ChatService } from "@cosmora/core";
import { compactChatHistory, ContextTooLargeError } from "@cosmora/core";
import { ContextMemoryError, type GeneralChatStore } from "@cosmora/db";
import type {
  GeneralChatMessage,
  IdentityContext,
  HistoryCompactionPreview
} from "@cosmora/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";

export function registerHistoryCompactionRoutes(
  app: FastifyInstance,
  store: GeneralChatStore,
  chat: ChatService,
  identityFor: (r: FastifyRequest) => IdentityContext
) {
  app.post<{ Params: { chatId: string }; Body: { query: string } }>(
    "/api/v1/chats/:chatId/history-compaction/preview",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: {
        params: Type.Object(
          { chatId: Type.String({ minLength: 1, maxLength: 128 }) },
          { additionalProperties: false }
        ),
        body: Type.Object(
          { query: Type.String({ minLength: 1, maxLength: 1000, pattern: "\\S" }) },
          { additionalProperties: false }
        )
      }
    },
    (r, reply) => {
      reply.header("Cache-Control", "private, no-store");
      try {
        const owner = identityFor(r).owner_id,
          id = r.params.chatId;
        if (!store.getChat(id, owner))
          return reply.code(404).send({ error: { code: "CHAT_NOT_FOUND" } });
        const options = store.historyCompactionOptions(id, owner, r.body.query);
        const now = new Date().toISOString();
        const question: GeneralChatMessage = {
          id: randomUUID(),
          chat_id: id,
          content: r.body.query,
          role: "user",
          content_type: "text",
          status: "completed",
          run_id: null,
          error_code: null,
          created_at: now,
          updated_at: now
        };
        const messages = store.historyCompactionPreviewMessages(id, owner, question);
        const compacted = compactChatHistory(messages, options);
        const recall = store.contextMemory.resolve(
          { kind: "chat", id },
          owner,
          r.body.query,
          messages.slice(-8).map((m) => m.id)
        );
        const context = {
          chatId: id,
          runId: randomUUID(),
          messages,
          recalledMemory: recall,
          memoryNotes: store.getChatMemory(id, owner)?.memory_notes ?? ""
        };
        const preview: HistoryCompactionPreview = {
          report: compacted.report,
          memory: compacted.memory ?? null,
          before_input_upper_bound: null,
          after_input_upper_bound: null,
          dispatch_blocked: false
        };
        try {
          preview.before_input_upper_bound =
            chat.buildRequest(context).routing.estimated_input_tokens;
        } catch (error) {
          if (!(error instanceof ContextTooLargeError)) throw error;
        }
        try {
          preview.after_input_upper_bound = chat.buildRequest({
            ...context,
            historyCompaction: options
          }).routing.estimated_input_tokens;
        } catch (error) {
          if (!(error instanceof ContextTooLargeError)) throw error;
          preview.dispatch_blocked = true;
        }
        return preview;
      } catch (error) {
        if (error instanceof ContextMemoryError)
          return reply.code(error.status).send({ error: { code: error.code } });
        throw error;
      }
    }
  );
}
