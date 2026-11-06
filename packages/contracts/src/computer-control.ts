import { Type, type Static, type TSchema } from "typebox";

const object = <T extends Record<string, TSchema>>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });
const text = (maximum: number) => Type.String({ minLength: 1, maxLength: maximum });
const formulaRef = "\\$?[A-Z]{1,3}\\$?[1-9][0-9]{0,5}";
const documentCell = Type.Union([
  Type.Null(),
  Type.String({ maxLength: 500 }),
  Type.Number({ minimum: -999999999999999, maximum: 999999999999999 }),
  object({
    formula: Type.String({
      minLength: 1,
      maxLength: 256,
      pattern:
        "^(?:SUM|AVERAGE|MIN|MAX|COUNT)\\(" +
        formulaRef +
        "(?::" +
        formulaRef +
        ")?(?:," +
        formulaRef +
        "(?::" +
        formulaRef +
        ")?)*\\)$"
    })
  })
]);

/** Proposals, never executable JavaScript, shell commands or an unbounded RPC. */
export const ComputerActionSchema = Type.Union([
  object({
    kind: Type.Literal("work_plan"),
    steps: Type.Array(object({ title: text(180), criteria: text(240) }), {
      minItems: 1,
      maxItems: 8
    })
  }),
  object({
    kind: Type.Literal("work_switch"),
    environment: Type.Union([Type.Literal("browser"), Type.Literal("computer")])
  }),
  object({
    kind: Type.Literal("work_step"),
    step: Type.Integer({ minimum: 1, maximum: 8 }),
    state: Type.Union([Type.Literal("running"), Type.Literal("checked")]),
    evidence: Type.String({ maxLength: 500 }),
    observation_id: text(128)
  }),
  object({ kind: Type.Literal("browser_tabs") }),
  object({ kind: Type.Literal("browser_back") }),
  object({ kind: Type.Literal("browser_forward") }),
  object({ kind: Type.Literal("browser_reload") }),
  object({ kind: Type.Literal("browser_read") }),
  object({
    kind: Type.Literal("browser_read_text"),
    offset_utf16: Type.Integer({ minimum: 0, maximum: 256000 }),
    expected_version: Type.Union([Type.Null(), Type.String({ pattern: "^sha256:[a-f0-9]{64}$" })])
  }),
  object({ kind: Type.Literal("browser_screenshot") }),
  object({ kind: Type.Literal("browser_open"), url: text(4096) }),
  object({ kind: Type.Literal("browser_search"), query: text(240) }),
  object({
    kind: Type.Literal("browser_switch"),
    tab_id: Type.String({ pattern: "^[a-f0-9]{12}$" })
  }),
  object({
    kind: Type.Literal("browser_close"),
    tab_id: Type.String({ pattern: "^[a-f0-9]{12}$" })
  }),
  object({ kind: Type.Literal("browser_click"), ref: text(16) }),
  object({
    kind: Type.Literal("browser_fill"),
    ref: text(16),
    text: Type.String({ maxLength: 4000 })
  }),
  object({
    kind: Type.Literal("browser_key"),
    ref: text(16),
    key: Type.Union([Type.Literal("ENTER"), Type.Literal("TAB"), Type.Literal("ESCAPE")])
  }),
  object({
    kind: Type.Literal("browser_scroll"),
    direction: Type.Union([Type.Literal("up"), Type.Literal("down")]),
    amount: Type.Integer({ minimum: 1, maximum: 5 })
  }),
  object({
    kind: Type.Literal("browser_click_at"),
    x: Type.Number({ minimum: 0, maximum: 1 }),
    y: Type.Number({ minimum: 0, maximum: 1 })
  }),
  object({ kind: Type.Literal("browser_upload"), ref: text(16), path: text(512) }),
  object({ kind: Type.Literal("browser_download"), ref: text(16) }),

  object({
    kind: Type.Literal("workspace_list"),
    path: Type.String({ maxLength: 512 }),
    cursor: Type.Integer({ minimum: 0, maximum: 2000 })
  }),
  object({
    kind: Type.Literal("workspace_find"),
    path: Type.String({ maxLength: 512 }),
    mode: Type.Union([Type.Literal("name"), Type.Literal("text")]),
    query: text(200)
  }),
  object({ kind: Type.Literal("workspace_read"), path: text(512) }),
  object({
    kind: Type.Literal("workspace_read_pdf"),
    path: text(512),
    page_index: Type.Integer({ minimum: 0, maximum: 1999 }),
    mode: Type.Union([Type.Literal("auto"), Type.Literal("text"), Type.Literal("ocr")]),
    offset_utf16: Type.Integer({ minimum: 0, maximum: 180000 }),
    expected_text_sha256: Type.Union([Type.Null(), Type.String({ pattern: "^[a-f0-9]{64}$" })]),
    expected_version: Type.Union([Type.Null(), Type.String({ pattern: "^sha256:[a-f0-9]{64}$" })])
  }),
  object({
    kind: Type.Literal("workspace_read_document"),
    path: text(512),
    offset_utf16: Type.Integer({ minimum: 0, maximum: 256000 }),
    expected_version: Type.Union([Type.Null(), Type.String({ pattern: "^sha256:[a-f0-9]{64}$" })])
  }),
  object({
    kind: Type.Literal("workspace_read_lines"),
    path: text(512),
    start_line: Type.Integer({ minimum: 1, maximum: 2097153 }),
    end_line: Type.Integer({ minimum: 1, maximum: 2097153 }),
    expected_version: Type.Union([Type.Null(), Type.String({ pattern: "^sha256:[a-f0-9]{64}$" })])
  }),
  object({ kind: Type.Literal("workspace_mkdir"), path: text(512) }),
  object({
    kind: Type.Literal("workspace_create"),
    path: text(512),
    content: Type.String({ maxLength: 10000 })
  }),
  object({
    kind: Type.Literal("workspace_create_docx"),
    path: text(512),
    title: text(180),
    sections: Type.Array(
      object({ heading: Type.String({ maxLength: 180 }), text: Type.String({ maxLength: 1600 }) }),
      { minItems: 1, maxItems: 8 }
    )
  }),
  object({
    kind: Type.Literal("workspace_create_xlsx"),
    path: text(512),
    sheets: Type.Array(
      object({
        name: text(31),
        rows: Type.Array(Type.Array(documentCell, { minItems: 1, maxItems: 10 }), {
          minItems: 1,
          maxItems: 40
        })
      }),
      { minItems: 1, maxItems: 3 }
    )
  }),
  object({
    kind: Type.Literal("workspace_create_pptx"),
    path: text(512),
    title: text(180),
    slides: Type.Array(
      object({ title: Type.String({ maxLength: 180 }), text: Type.String({ maxLength: 1600 }) }),
      { minItems: 1, maxItems: 12 }
    )
  }),
  object({
    kind: Type.Literal("workspace_update"),
    path: text(512),
    content: Type.String({ maxLength: 10000 }),
    expected_version: Type.String({ pattern: "^sha256:[a-f0-9]{64}$" })
  }),
  object({ kind: Type.Literal("workspace_backups"), path: text(512) }),
  object({
    kind: Type.Literal("workspace_restore"),
    backup_id: Type.String({ pattern: "^bkp_[0-9]{1,16}_[a-f0-9]{12}$" }),
    expected_version: Type.String({ pattern: "^sha256:[a-f0-9]{64}$" })
  }),
  object({ kind: Type.Literal("observe") }),
  object({ kind: Type.Literal("list_apps") }),
  object({ kind: Type.Literal("find_apps"), query: text(100) }),
  object({ kind: Type.Literal("open_app"), app_id: text(240) }),
  object({ kind: Type.Literal("open_url"), url: text(2048) }),
  object({ kind: Type.Literal("open_file"), path: text(1000) }),
  object({ kind: Type.Literal("focus"), window_id: text(32) }),
  object({
    kind: Type.Literal("hover"),
    x: Type.Number({ minimum: 0, maximum: 1 }),
    y: Type.Number({ minimum: 0, maximum: 1 })
  }),
  object({
    kind: Type.Literal("drag"),
    from_x: Type.Number({ minimum: 0, maximum: 1 }),
    from_y: Type.Number({ minimum: 0, maximum: 1 }),
    to_x: Type.Number({ minimum: 0, maximum: 1 }),
    to_y: Type.Number({ minimum: 0, maximum: 1 })
  }),
  object({
    kind: Type.Literal("click"),
    x: Type.Number({ minimum: 0, maximum: 1 }),
    y: Type.Number({ minimum: 0, maximum: 1 }),
    button: Type.Union([Type.Literal("left"), Type.Literal("right")]),
    count: Type.Integer({ minimum: 1, maximum: 2 })
  }),
  object({ kind: Type.Literal("type_text"), text: text(4000) }),
  object({ kind: Type.Literal("press"), keys: Type.Array(text(16), { minItems: 1, maxItems: 4 }) }),
  object({
    kind: Type.Literal("scroll"),
    direction: Type.Union([
      Type.Literal("up"),
      Type.Literal("down"),
      Type.Literal("left"),
      Type.Literal("right")
    ]),
    amount: Type.Integer({ minimum: 1, maximum: 10 })
  }),
  object({
    kind: Type.Literal("wait"),
    milliseconds: Type.Integer({ minimum: 100, maximum: 2000 })
  }),
  object({ kind: Type.Literal("ask_user"), question: text(2000) }),
  object({ kind: Type.Literal("done"), summary: text(4000) })
]);
export type ComputerAction = Static<typeof ComputerActionSchema>;

export const ComputerProposalSchema = object({
  action: ComputerActionSchema,
  message: Type.String({ maxLength: 1000 }),
  requires_confirmation: Type.Boolean()
});
export type ComputerProposal = Static<typeof ComputerProposalSchema>;

/** Added by the API from a completed Gateway run, never accepted from model output. */
export const ComputerDecisionSchema = object({
  ...ComputerProposalSchema.properties,
  decision_source: object({
    kind: Type.Literal("model_gateway"),
    mode: Type.Union([Type.Literal("provider"), Type.Literal("test")]),
    provider_id: text(160),
    model_id: text(240),
    run_id: text(128),
    session_id: text(128),
    step: Type.Integer({ minimum: 0, maximum: 89 })
  })
});
export type ComputerDecision = Static<typeof ComputerDecisionSchema>;
export const ComputerSessionAcceptanceSchema = object({
  supports_workspace_read_lines: Type.Optional(Type.Literal(true)),
  supports_workspace_documents: Type.Optional(Type.Literal(true)),
  supports_workspace_document_reads: Type.Optional(Type.Literal(true)),
  supports_workspace_pdf_reads: Type.Optional(Type.Literal(true)),
  supports_work_reference: Type.Optional(Type.Literal(true)),
  supports_browser_text_reads: Type.Optional(Type.Literal(true)),
  execution_mode: Type.Optional(
    Type.Union([Type.Literal("computer"), Type.Literal("browser"), Type.Literal("work")])
  ),
  id: text(128),
  expires_at: text(64),
  planner: object({
    kind: Type.Literal("model_gateway"),
    mode: Type.Union([Type.Literal("provider"), Type.Literal("test")])
  })
});

export const ComputerObservationSchema = object({
  work: Type.Optional(
    object({
      environment: Type.Union([
        Type.Literal("none"),
        Type.Literal("browser"),
        Type.Literal("computer")
      ]),
      generation: Type.Integer({ minimum: 0 }),
      plan_steps: Type.Integer({ minimum: 0, maximum: 8 }),
      plan_complete: Type.Boolean()
    })
  ),
  browser: Type.Optional(
    object({
      tab_id: Type.String({ pattern: "^[a-f0-9]{12}$" }),
      generation: Type.Integer({ minimum: 0 }),
      read_text: Type.Optional(Type.Literal(true))
    })
  ),
  workspace: Type.Optional(
    object({
      id: Type.String({ pattern: "^[a-f0-9]{24}$" }),
      name: text(180),
      read_lines: Type.Optional(Type.Literal(true)),
      create_documents: Type.Optional(Type.Literal(true)),
      read_documents: Type.Optional(Type.Literal(true)),
      read_pdf: Type.Optional(Type.Literal(true))
    })
  ),
  observation_id: text(128),
  active_window: Type.String({ maxLength: 32 }),
  description: Type.String({ maxLength: 16000 }),
  width: Type.Integer({ minimum: 1, maximum: 8192 }),
  height: Type.Integer({ minimum: 1, maximum: 8192 }),
  image_jpeg_base64: Type.Optional(text(1_333_336))
});
export type ComputerObservation = Static<typeof ComputerObservationSchema>;

export const CreateComputerSessionSchema = object({
  execution_mode: Type.Optional(
    Type.Union([Type.Literal("computer"), Type.Literal("browser"), Type.Literal("work")])
  ),
  client_request_id: text(128),
  client_secret: Type.String({ minLength: 43, maxLength: 43, pattern: "^[A-Za-z0-9_-]+$" }),
  goal: text(8000),
  max_steps: Type.Integer({ minimum: 1, maximum: 90 })
});
export type CreateComputerSession = Static<typeof CreateComputerSessionSchema>;
export const WorkReferenceSchema = object({
  format: Type.Literal("koswork.accepted-example.v1"),
  source_task_id: Type.String({
    pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$"
  }),
  source_project_id: text(160),
  accepted_at: Type.Integer({ minimum: 0 }),
  outcome: Type.Literal("owner_accepted"),
  source_goal: text(500),
  goal_excerpt_only: Type.Boolean(),
  revision: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  plan: Type.Array(object({ title: text(180), criteria: text(240) }), { minItems: 1, maxItems: 8 }),
  tool_observations: Type.Array(
    object({
      kind: Type.String({ pattern: "^[a-z_]{1,64}$" }),
      count: Type.Integer({ minimum: 1, maximum: 90 })
    }),
    { maxItems: 16 }
  ),
  tool_summary_truncated: Type.Boolean()
});
export const ComputerStepSchema = object({
  work_reference: Type.Optional(WorkReferenceSchema),
  step: Type.Integer({ minimum: 0, maximum: 89 }),
  observation: ComputerObservationSchema,
  previous_result: Type.String({ maxLength: 16000 })
});
export type ComputerStep = Static<typeof ComputerStepSchema>;
export const AuthorizeComputerActionSchema = object({
  step: Type.Integer({ minimum: 0, maximum: 89 }),
  action_hash: Type.String({ minLength: 64, maxLength: 64, pattern: "^[a-f0-9]+$" })
});
