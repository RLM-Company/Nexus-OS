import { installChatReliabilityFixture } from "./chat-reliability-provider.js";

installChatReliabilityFixture();
await import("../../src/server.js");
