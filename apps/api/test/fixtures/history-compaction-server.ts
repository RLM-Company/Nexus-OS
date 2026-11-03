// Dedicated Playwright fixture, never imported by production.
if (process.env.NODE_ENV !== "test" || process.env.MODEL_PROVIDER !== "mock")
  throw new Error("Compaction fixture requires explicit test/mock environment");
const { loadServerConfig } = await import("@cosmora/config");
const { openDatabase, runMigrations, ProjectStore, EmergencyStopStore } =
  await import("@cosmora/db");
const { buildApp } = await import("../../src/app.js");
const { buildModelRuntime } = await import("../../src/model-runtime.js");
const { seedCompactionHistory } = await import("./compaction-history.js");
const db = openDatabase(":memory:");
await runMigrations(db);
const seed = seedCompactionHistory(db);
const blocked = seedCompactionHistory(db, "local-owner", true);
const profile = seed.store.createChat(
  "Меня зовут Александр.\nЯ предпочитаю краткие ответы на русском.",
  crypto.randomUUID()
);
seed.store.cancelRun(profile.run.id);
const config = loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" });
const runtime = await buildModelRuntime(config);
let modelCalls = 0;
const originalStream = runtime.gateway.stream.bind(runtime.gateway);
runtime.gateway.stream = (request, signal) => {
  modelCalls++;
  return originalStream(request, signal);
};
const app = buildApp({
  config,
  database: db,
  generalChatStore: seed.store,
  projectStore: new ProjectStore(db.sqlite),
  emergencyStopStore: new EmergencyStopStore(db.sqlite),
  modelGateway: runtime.gateway,
  manager: runtime.manager,
  chat: runtime.chat
});
app.get("/fixture/compaction", () => ({
  chatId: seed.chatId,
  blockedChatId: blocked.chatId,
  title: seed.store.getChat(seed.chatId)!.title,
  blockedTitle: blocked.store.getChat(blocked.chatId)!.title,
  profileId: profile.chat.id,
  profileTitle: profile.chat.title,
  modelCalls
}));
await app.listen({ host: "127.0.0.1", port: 3225 });
for (const event of ["SIGINT", "SIGTERM"] as const)
  process.once(event, () => {
    void app.close().finally(() => {
      db.close();
    });
  });
