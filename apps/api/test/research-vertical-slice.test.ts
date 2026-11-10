import test from "node:test";
import assert from "node:assert/strict";
import { createResearchRouter, ResearchService } from "../src/research";
import { buildResearchWorkspaceViewModel } from "../../web/src/app/research-workspace/view-model";

test("API research vertical slice + Web research-workspace view-model enforce quote entailment, contradictions, query cap, checkpoint & honest 'не удалось установить'", async () => {
  const service = new ResearchService();
  const router = createResearchRouter(service);

  // 1. Create session via route
  const createRes = await router({
    method: "POST",
    path: "/api/research/sessions",
    body: {
      projectId: "proj-alpha",
      title: "Анализ облачных СУБД 2026",
      goal: "Проверить цены и SLA по официальным спецификациям и архиву",
      options: ["OrionDB"],
      criteria: ["Базовая цена", "Закрытый аудит SOC3"],
      maxQueriesPerQuestion: 2,
      maxTotalQueries: 4,
    },
  });
  assert.equal(createRes.status, 201);
  const session = createRes.body as ReturnType<ResearchService["getSession"]>;
  assert.equal(session.subQuestions.length, 2);

  // 2. Enforce query budget per question
  const q1Id = session.subQuestions[0].id;
  service.recordSearchQuery(session.sessionId, q1Id);
  service.recordSearchQuery(session.sessionId, q1Id);
  assert.throws(
    () => service.recordSearchQuery(session.sessionId, q1Id),
    /RESEARCH_QUESTION_QUERY_BUDGET_EXCEEDED/
  );

  // 3. Register two conflicting sources (2026 vs 2025) + 1 duplicate URL
  const src2026Res = await router({
    method: "POST",
    path: `/api/research/sessions/${session.sessionId}/sources`,
    body: {
      url: "https://docs.example.com/oriondb/2026?utm_source=test",
      title: "OrionDB 2026 Official Docs",
      publishedDate: "2026-10-15",
      textContent:
        "Официальная документация OrionDB 2026. Базовая цена составляет $29/мес. Старый тариф $49/мес устарел.",
      readingLimitations: ["1 cross-origin iframe пропущен по политике безопасности"],
    },
  });
  assert.equal(src2026Res.status, 200);
  const src2026 = (src2026Res.body as any).source;
  assert.equal((src2026Res.body as any).deduplicated, false);

  // Duplicate canonical URL is deduplicated
  const dupRes = await router({
    method: "POST",
    path: `/api/research/sessions/${session.sessionId}/sources`,
    body: {
      url: "https://docs.example.com/oriondb/2026",
      title: "OrionDB 2026 Official Docs Dup",
      textContent: "Другой текст",
    },
  });
  assert.equal((dupRes.body as any).deduplicated, true);

  const src2025Res = await router({
    method: "POST",
    path: `/api/research/sessions/${session.sessionId}/sources`,
    body: {
      url: "https://archive.example.org/oriondb/2025",
      title: "OrionDB 2025 Archive",
      publishedDate: "2025-04-10",
      textContent: "Архивный прайс-лист OrionDB 2025. Базовая цена составляет $49/мес.",
    },
  });
  const src2025 = (src2025Res.body as any).source;

  // Record explicit unavailable source
  service.recordUnavailableSource(session.sessionId, {
    url: "https://down.example.net/oriondb",
    status: 503,
    reason: "Service Unavailable",
  });

  // 4. Reject non-empty quote that does not match claimed value
  const badQuoteRes = await router({
    method: "POST",
    path: `/api/research/sessions/${session.sessionId}/evidence`,
    body: {
      sourceId: src2026.sourceId,
      optionName: "OrionDB",
      criterion: "Базовая цена",
      claimedValue: "$199/мес",
      verbatimQuote: "Базовая цена составляет $29/мес.",
    },
  });
  assert.equal(badQuoteRes.status, 400);
  assert.match(String((badQuoteRes.body as any).error), /CLAIM_VALUE_NOT_IN_QUOTE/);

  // 5. Reject quote with negation/deprecation marker ("устарел")
  const negatedQuoteRes = await router({
    method: "POST",
    path: `/api/research/sessions/${session.sessionId}/evidence`,
    body: {
      sourceId: src2026.sourceId,
      optionName: "OrionDB",
      criterion: "Базовая цена",
      claimedValue: "$49/мес",
      verbatimQuote: "Старый тариф $49/мес устарел.",
    },
  });
  assert.equal(negatedQuoteRes.status, 400);
  assert.match(
    String((negatedQuoteRes.body as any).error),
    /QUOTE_CONTAINS_NEGATION_OR_DEPRECATION/
  );

  // 6. Attach valid conflicting evidence from 2026 ($29/мес) and 2025 ($49/мес)
  const ev1Res = await router({
    method: "POST",
    path: `/api/research/sessions/${session.sessionId}/evidence`,
    body: {
      sourceId: src2026.sourceId,
      optionName: "OrionDB",
      criterion: "Базовая цена",
      claimedValue: "$29/мес",
      verbatimQuote: "Базовая цена составляет $29/мес.",
    },
  });
  assert.equal(ev1Res.status, 200);

  const ev2Res = await router({
    method: "POST",
    path: `/api/research/sessions/${session.sessionId}/evidence`,
    body: {
      sourceId: src2025.sourceId,
      optionName: "OrionDB",
      criterion: "Базовая цена",
      claimedValue: "$49/мес",
      verbatimQuote: "Базовая цена составляет $49/мес.",
    },
  });
  assert.equal(ev2Res.status, 200);

  // 7. Cancel with checkpoint and resume
  const cancelled = service.cancelSessionWithCheckpoint(session.sessionId, "evidence_collection");
  assert.equal(cancelled.status, "cancelled");
  assert.ok(cancelled.checkpoint);

  const resumed = service.resumeSessionFromCheckpoint(session.sessionId);
  assert.equal(resumed.status, "running");

  // 8. Finalize session -> unconfirmed criterion becomes "не удалось установить", handoff created
  let handoffReceived = false;
  const finalized = service.finalizeAndHandoffToProject(session.sessionId, (handoff) => {
    handoffReceived = true;
    assert.equal(handoff.projectId, "proj-alpha");
    assert.equal(handoff.confirmedCount, 1);
    assert.equal(handoff.unconfirmedCount, 1);
    assert.equal(handoff.contradictionCount, 1);
  });
  assert.equal(handoffReceived, true);
  assert.equal(finalized.status, "completed");

  // 9. Verify web research-workspace view-model
  const vm = buildResearchWorkspaceViewModel(finalized);
  assert.equal(vm.statusBadgeRu, "Исследование завершено");
  assert.equal(vm.matrixRows[0].cells[0].displayValue, "$29/мес");
  assert.equal(vm.matrixRows[0].cells[0].hasConflict, true);
  assert.equal(vm.matrixRows[0].cells[1].displayValue, "не удалось установить");
  assert.equal(vm.matrixRows[0].cells[1].isUnconfirmed, true);
  assert.equal(vm.unavailableSourcesBannerRu.length, 1);
  assert.equal(vm.readingLimitationNotesRu.length, 1);
});
