import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { setTimeout } from "node:timers/promises";
import { pathToFileURL, URL } from "node:url";

const TARGET = "scripts/provider-connection-check.mjs";
const CONTEXT = [TARGET, "scripts/test/provider-connection-check.test.mjs"];
const REPOSITORY = "RLM-Company/Nexus-OS";
const OPT_IN = "MODEL_TASK_AND_REVIEWED_DRAFT_PR";
const check = (condition, code) => {
  if (!condition) throw Error(code);
};
const sha = (text) => createHash("sha256").update(text).digest("hex");
const jsonHash = (value) => sha(JSON.stringify(value));
const safeError = (error) =>
  error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
    ? error.message
    : "ACCEPTANCE_FAILED";
const write = (file, value, exclusive = false) =>
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
    ...(exclusive ? { flag: "wx" } : {})
  });

export const COSCODE_ACCEPTANCE_TASK = `Исправь баг диагностики потока ответа только в scripts/provider-connection-check.mjs, функция verifyStream.
Сейчас наличие текста и любого finish_reason либо [DONE]/message_stop ошибочно считается успешным завершением.
OpenAI: если явно передан ненулевой finish_reason, допустим только "stop". length, content_filter, tool_calls, function_call, пустая строка и неизвестные причины должны отклоняться, даже если далее пришёл [DONE].
Anthropic: явно переданный ненулевой delta.stop_reason в message_delta допускает только end_turn или stop_sequence. max_tokens, tool_use, pause_turn, refusal, model_context_window_exceeded и неизвестные причины должны отклоняться, даже если далее пришёл message_stop.
Сохрани совместимость потоков, где причина не передана: текст плюс прежний завершающий маркер по-прежнему достаточны. Не ослабляй остальные проверки, ограничения, отсутствие повторов и сокрытие ошибок провайдера. Сообщение ошибки общее, без значений причины, тела ответа, URL или ключей.
Контекст уже передан: изменение небольшое. Верни минимальные точные edits для существующего файла; только реализацию, без изменения тестов, других файлов, зависимостей или конфигурации. Существующие Node-тесты будут выполнены изолированным исполнителем, новые случаи проверит интегратор независимо.`;

export function codeAcceptanceConfiguration(env) {
  check(env.COSMORA_ALLOW_CODE_ACCEPTANCE === OPT_IN, "CODE_ACCEPTANCE_OPT_IN_REQUIRED");
  check(["generate", "collect", "publish"].includes(env.COSMORA_CODE_ACTION), "ACTION_REQUIRED");
  let origin;
  try {
    origin = new URL(env.COSMORA_API_ORIGIN ?? "http://127.0.0.1:3100");
  } catch {
    throw Error("LOOPBACK_API_REQUIRED");
  }
  check(
    origin.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) &&
      !origin.username &&
      !origin.password &&
      !origin.search &&
      !origin.hash &&
      origin.pathname === "/",
    "LOOPBACK_API_REQUIRED"
  );
  check(
    typeof env.COSMORA_OWNER_SESSION_TOKEN === "string" &&
      /^[^\s]+$/.test(env.COSMORA_OWNER_SESSION_TOKEN),
    "OWNER_SESSION_REQUIRED"
  );
  check(
    typeof env.COSMORA_CODE_OUTPUT_DIR === "string" && path.isAbsolute(env.COSMORA_CODE_OUTPUT_DIR),
    "ABSOLUTE_RECEIPT_DIRECTORY_REQUIRED"
  );
  return {
    origin: origin.origin,
    action: env.COSMORA_CODE_ACTION,
    directory: env.COSMORA_CODE_OUTPUT_DIR
  };
}

export function validateCodeProposal(run, receipt) {
  check(
    run.id &&
      run.project_id === receipt.project_id &&
      run.client_request_id === receipt.client_request_id &&
      run.task === COSCODE_ACCEPTANCE_TASK &&
      run.repository === REPOSITORY &&
      run.base_branch === "main" &&
      /^[a-f0-9]{40}$/.test(run.base_sha),
    "TASK_RECEIPT_MISMATCH"
  );
  check(
    run.status === "proposed" &&
      !run.draft_id &&
      run.proposal?.length === 1 &&
      run.proposal[0].path === TARGET &&
      typeof run.proposal[0].before === "string" &&
      typeof run.proposal[0].content === "string" &&
      run.proposal[0].before !== run.proposal[0].content,
    "UNEXPECTED_PROPOSAL"
  );
  check(
    run.proposal_hash === jsonHash({ base: run.base_sha, proposal: run.proposal }),
    "PROPOSAL_HASH_MISMATCH"
  );
  check(
    run.proposal_check?.status === "passed" &&
      run.proposal_check.cleanupVerified === true &&
      run.proposal_check.proposal_hash === run.proposal_hash &&
      run.proposal_check.exitCode === 0,
    "OCI_CHECK_NOT_PASSED"
  );
  return {
    project_id: run.project_id,
    code_id: run.id,
    base_sha: run.base_sha,
    proposal_hash: run.proposal_hash,
    source_sha256: sha(run.proposal[0].content),
    summary: run.summary,
    files: run.proposal.map(({ path, content }) => ({ path, content })),
    check: run.proposal_check,
    model_run_ids: run.model_run_ids,
    usage: run.usage
  };
}

/** Operator-only acceptance. generate may call the model; collect only reads.
 * publish requires a separately reviewed hash AND the exact independently tested file hash.
 * No write is retried, including uncertain publication. Receipts survive process restarts.
 */
export async function runCodeAcceptance(env, fetchImpl = globalThis.fetch) {
  const config = codeAcceptanceConfiguration(env);
  const receiptPath = path.join(config.directory, "receipt.json");
  let receipt;
  if (config.action === "generate") {
    fs.mkdirSync(config.directory, { mode: 0o700 });
    receipt = {
      format: "kosmora.coscode-acceptance.v1",
      started_at: new Date().toISOString(),
      project_id: randomUUID(),
      client_request_id: randomUUID(),
      state: "not_dispatched"
    };
    write(receiptPath, receipt, true);
  } else {
    receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    check(
      receipt.format === "kosmora.coscode-acceptance.v1" &&
        /^[a-f0-9-]{36}$/.test(receipt.project_id) &&
        /^[a-f0-9-]{36}$/.test(receipt.client_request_id),
      "INVALID_RECEIPT"
    );
  }
  const save = () => write(receiptPath, receipt);
  const request = async (route, method = "GET", body, allowed = [200]) => {
    const url = new URL(route, config.origin);
    check(url.origin === config.origin && url.pathname.startsWith("/api/v1/"), "API_PATH_REQUIRED");
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        redirect: "error",
        signal: globalThis.AbortSignal.timeout(90_000),
        headers: {
          Authorization: "Bearer " + env.COSMORA_OWNER_SESSION_TOKEN,
          ...(body !== undefined ? { "content-type": "application/json" } : {})
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
      });
    } catch {
      throw Error("REQUEST_OUTCOME_UNKNOWN");
    }
    check(allowed.includes(response.status), "HTTP_" + response.status);
    return response.json();
  };
  const codeBase = "/api/v1/projects/" + receipt.project_id + "/code-agent";
  const collect = async () => {
    const deadline = Date.now() + 650_000;
    while (Date.now() < deadline) {
      const run = await request(codeBase + "/by-request/" + receipt.client_request_id);
      receipt.code_id = run.id;
      receipt.last_status = run.status;
      receipt.model_run_ids = run.model_run_ids;
      receipt.code_error = /^[A-Z0-9_]{1,80}$/.test(run.error) ? run.error : undefined;
      receipt.provider_diagnostic = /^[A-Z0-9_]{1,80}$/.test(run.provider_diagnostic)
        ? run.provider_diagnostic
        : undefined;
      save();
      check(
        !["failed", "cancelled"].includes(run.status),
        "CODE_TASK_" + (run.status === "failed" ? "FAILED" : "CANCELLED")
      );
      if (run.status === "proposed") {
        const proposal = validateCodeProposal(run, receipt);
        const ids = new Set(proposal.model_run_ids);
        check(ids.size > 0 && ids.size <= 6, "MODEL_CALL_COUNT_INVALID");
        const usage = await request("/api/v1/personal-settings/usage");
        const rows = usage.rows.filter((r) => ids.has(r.run_id));
        check(
          rows.length === ids.size &&
            rows.every(
              (r) =>
                r.status === "committed" &&
                typeof r.provider_id === "string" &&
                r.provider_id !== "mock" &&
                Number.isInteger(r.input_tokens) &&
                Number.isInteger(r.output_tokens)
            ),
          "REAL_CANONICAL_USAGE_REQUIRED"
        );
        proposal.canonical_usage = rows;
        write(path.join(config.directory, "proposal.json"), proposal);
        fs.writeFileSync(
          path.join(config.directory, "provider-connection-check.proposed.mjs"),
          proposal.files[0].content,
          { mode: 0o600 }
        );
        receipt.state = "proposal_ready_for_independent_review";
        receipt.proposal_hash = proposal.proposal_hash;
        receipt.source_sha256 = proposal.source_sha256;
        receipt.proposal_ready_at = new Date().toISOString();
        delete receipt.error;
        save();
        return receipt;
      }
      check(["running", "checking"].includes(run.status), "UNEXPECTED_CODE_STATUS");
      await setTimeout(500);
    }
    throw Error("COLLECTION_TIMEOUT_USE_READ_ONLY_COLLECT");
  };
  try {
    if (config.action === "collect") return await collect();
    if (config.action === "generate") {
      const runtime = await request("/api/v1/model-runtime");
      check(
        runtime.mode !== "mock" &&
          runtime.provider !== "mock" &&
          runtime.credential_configured === true &&
          runtime.fallback_to_mock === false &&
          runtime.max_attempts_per_route === 1,
        "REAL_SINGLE_ATTEMPT_MODEL_REQUIRED"
      );
      const github = await request("/api/v1/github/status");
      check(github.configured && github.repository === REPOSITORY, "BOUND_REPOSITORY_REQUIRED");
      const operations = await request("/api/v1/operations/status");
      check(operations.process_stop === null, "EMERGENCY_STOP_ACTIVE");
      const privacy = await request("/api/v1/personal-settings/privacy");
      check(privacy.ready && privacy.lifecycle === "active", "OWNER_NOT_READY");
      await request("/api/v1/code-projects", "POST", {
        client_project_id: receipt.project_id,
        title: "Coscode: проверка завершения ответа провайдера",
        approve_local_execution: true
      });
      receipt.state = "generation_submission_attempted";
      receipt.generation_submitted_at = new Date().toISOString();
      save();
      await request(codeBase, "POST", {
        client_request_id: receipt.client_request_id,
        task: COSCODE_ACCEPTANCE_TASK,
        base_branch: "main",
        files: CONTEXT,
        auto_check: { check: "node-test", approve: true }
      });
      receipt.state = "generation_accepted";
      save();
      return await collect();
    }
    const proposal = JSON.parse(
      fs.readFileSync(path.join(config.directory, "proposal.json"), "utf8")
    );
    check(
      receipt.state === "proposal_ready_for_independent_review" &&
        env.COSMORA_CODE_APPROVED_PROPOSAL_HASH === proposal.proposal_hash &&
        env.COSMORA_CODE_INDEPENDENTLY_TESTED_SHA256 === proposal.source_sha256,
      "EXACT_REVIEW_AND_INDEPENDENT_TEST_REQUIRED"
    );
    check(
      receipt.code_id === proposal.code_id && receipt.project_id === proposal.project_id,
      "TASK_RECEIPT_MISMATCH"
    );
    const current = await request(codeBase + "/" + receipt.code_id);
    const fresh = validateCodeProposal(current, receipt);
    check(
      fresh.proposal_hash === proposal.proposal_hash &&
        fresh.source_sha256 === proposal.source_sha256,
      "PROPOSAL_CHANGED"
    );
    write(
      path.join(config.directory, "publication-attempt.json"),
      {
        at: new Date().toISOString(),
        proposal_hash: proposal.proposal_hash
      },
      true
    );
    const reviewed = await request(codeBase + "/" + receipt.code_id + "/review", "POST", {
      proposal_hash: proposal.proposal_hash,
      files: proposal.files
    });
    check(
      reviewed.status === "checked" &&
        reviewed.check?.status === "passed" &&
        reviewed.check.cleanupVerified === true &&
        reviewed.publication_token,
      "REVIEW_CHECK_REQUIRED"
    );
    receipt.state = "publication_submission_attempted";
    save();
    const published = await request(codeBase + "/" + receipt.code_id + "/publish", "POST", {
      review_hash: reviewed.draft.plan.review_hash,
      publication_token: reviewed.publication_token,
      approve: true
    });
    check(published.status === "published", "PUBLICATION_REQUIRES_READ_ONLY_RECONCILIATION");
    const url = new URL(published.draft.pr_url);
    check(
      url.origin === "https://github.com" &&
        new RegExp("^/" + REPOSITORY + "/pull/[1-9][0-9]*$").test(url.pathname) &&
        !url.search &&
        !url.hash &&
        !url.username &&
        !url.password,
      "INVALID_DRAFT_PR_URL"
    );
    receipt.pr_url = url.href;
    const reopened = await request(codeBase + "/" + receipt.code_id);
    check(
      reopened.status === "published" && reopened.draft.pr_url === receipt.pr_url,
      "PUBLISHED_RESULT_NOT_SAVED"
    );
    const replay = await request(codeBase, "POST", {
      client_request_id: receipt.client_request_id,
      task: COSCODE_ACCEPTANCE_TASK,
      base_branch: "main",
      files: CONTEXT,
      auto_check: { check: "node-test", approve: true }
    });
    check(
      replay.id === receipt.code_id &&
        replay.status === "published" &&
        jsonHash(replay.model_run_ids) === jsonHash(proposal.model_run_ids),
      "REPLAY_DUPLICATED_CODE_TASK"
    );
    receipt.state = "published_and_reopened";
    receipt.finished_at = new Date().toISOString();
    delete receipt.error;
    save();
    return receipt;
  } catch (error) {
    receipt.error = safeError(error);
    save();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.stdout.write(JSON.stringify(await runCodeAcceptance(process.env), null, 2) + "\n");
  } catch (error) {
    process.stderr.write(safeError(error) + "\n");
    process.exitCode = 1;
  }
}
