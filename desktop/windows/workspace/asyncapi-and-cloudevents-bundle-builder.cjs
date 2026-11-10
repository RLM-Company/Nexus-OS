"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

/**
 * Zero-dependency AsyncAPI 2.6.0 Event-Driven Architecture Specification (.asyncapi.json) &
 * CNCF CloudEvents 1.0 Structured Batch Envelope Builder (.cloudevents.json).
 */
function buildAsyncApiAndCloudEvents(spec = {}) {
  const serviceTitle = spec.title || "Kosmora Autonomous Event Mesh";
  const version = spec.version || "2.17.0";
  const channelsInput = Array.isArray(spec.channels) ? spec.channels : [];
  const eventsInput = Array.isArray(spec.cloudEvents) ? spec.cloudEvents : [];

  const channelsObj = {};
  for (const ch of channelsInput) {
    const topic = ch.topic || "kosmora/kernel/events";
    channelsObj[topic] = {
      description: ch.description || `Event channel ${topic}`,
      publish: {
        operationId: ch.operationId || `publish_${topic.replace(/[^a-zA-Z0-9_]/g, "_")}`,
        message: {
          name: ch.messageName || "KernelDomainEvent",
          contentType: "application/cloudevents+json",
          payload: ch.schema || { type: "object" }
        }
      }
    };
  }

  const asyncApiObj = {
    asyncapi: "2.6.0",
    info: {
      title: serviceTitle,
      version
    },
    defaultContentType: "application/json",
    channels: channelsObj
  };

  const cloudEventsBatch = eventsInput.map((ev, idx) => ({
    specversion: "1.0",
    id: ev.id || `ce-${idx + 1}-${crypto.randomUUID()}`,
    source: ev.source || "urn:kosmora:kernel:actor-supervisor",
    type: ev.type || "ai.kosmora.kernel.task.completed",
    datacontenttype: "application/json",
    time: ev.timeIso || new Date().toISOString(),
    data: ev.data || {}
  }));

  return {
    asyncApiJson: JSON.stringify(asyncApiObj, null, 2) + "\n",
    cloudEventsJson: JSON.stringify(cloudEventsBatch, null, 2) + "\n",
    channelCount: channelsInput.length,
    eventCount: cloudEventsBatch.length
  };
}

function saveAsyncApiAndCloudEventsToWorkspace(workspaceDir, baseName, spec) {
  if (!workspaceDir || typeof workspaceDir !== "string") {
    throw new Error("WORKSPACE_REQUIRED");
  }
  const cleanBase = path
    .basename(baseName || "event-mesh")
    .replace(/\.(asyncapi\.json|cloudevents\.json|json)$/i, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  const resolvedWorkspace = path.resolve(workspaceDir);

  const asyncApiPath = path.resolve(resolvedWorkspace, `${cleanBase}.asyncapi.json`);
  const cloudEventsPath = path.resolve(
    resolvedWorkspace,
    `${cleanBase}.cloudevents.json`
  );

  if (!asyncApiPath.startsWith(resolvedWorkspace + path.sep)) {
    throw new Error("PATH_TRAVERSAL_BLOCKED");
  }

  fs.mkdirSync(resolvedWorkspace, { recursive: true });
  const built = buildAsyncApiAndCloudEvents(spec);
  fs.writeFileSync(asyncApiPath, built.asyncApiJson, "utf8");
  fs.writeFileSync(cloudEventsPath, built.cloudEventsJson, "utf8");

  return {
    asyncApiPath,
    cloudEventsPath,
    channelCount: built.channelCount,
    eventCount: built.eventCount,
    sha256: crypto
      .createHash("sha256")
      .update(built.asyncApiJson + built.cloudEventsJson, "utf8")
      .digest("hex")
  };
}

module.exports = {
  buildAsyncApiAndCloudEvents,
  saveAsyncApiAndCloudEventsToWorkspace
};
