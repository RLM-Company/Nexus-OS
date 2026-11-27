import { expect, it } from "vitest";
import {
  openDatabase,
  runMigrations,
  ProjectStore,
  ProjectMembershipStore,
  MembershipError
} from "../src/index.js";

const setup = async () => {
  const db = openDatabase(":memory:");
  await runMigrations(db);
  const projects = new ProjectStore(db.sqlite);
  const owner = projects.createProject("Shared doc", "shared-doc", "owner-a").project.id;
  return { db, projects, owner, members: new ProjectMembershipStore(db.sqlite) };
};

it("invites, accepts and enforces membership for two accounts", async () => {
  const { db, owner, members } = await setup();
  try {
    expect(members.canAccess(owner, "owner-b")).toBe(false);
    expect(members.canAccess(owner, "owner-c")).toBe(false);
    members.invite(owner, "owner-a", { account_id: "owner-b", role: "editor" });
    expect(() => members.requireAccess(owner, "owner-b")).toThrow(MembershipError);
    members.accept(owner, "owner-b");
    expect(members.canAccess(owner, "owner-b")).toBe(true);
    expect(members.canAccess(owner, "owner-b", "viewer")).toBe(true);
    expect(members.canAccess(owner, "owner-c")).toBe(false);
    const view = members.members(owner, "owner-a");
    expect(view.members.find((m) => m.account_id === "owner-b")).toMatchObject({
      role: "editor",
      status: "active"
    });
  } finally {
    db.close();
  }
});

it("revoke stops new data while owner keeps access", async () => {
  const { db, owner, members } = await setup();
  try {
    members.invite(owner, "owner-a", { account_id: "owner-b", role: "viewer" });
    members.accept(owner, "owner-b");
    expect(members.canAccess(owner, "owner-b")).toBe(true);
    members.revoke(owner, "owner-a", "owner-b");
    expect(members.canAccess(owner, "owner-b")).toBe(false);
    expect(members.canAccess(owner, "owner-a")).toBe(true);
    expect(() => members.revoke(owner, "owner-a", "owner-b")).toThrow(MembershipError);
  } finally {
    db.close();
  }
});

it("a member can leave and cannot re-enter without a new invitation", async () => {
  const { db, owner, members } = await setup();
  try {
    members.invite(owner, "owner-a", { account_id: "owner-b", role: "editor" });
    members.accept(owner, "owner-b");
    members.leave(owner, "owner-b");
    expect(members.canAccess(owner, "owner-b")).toBe(false);
    expect(() => members.accept(owner, "owner-b")).toThrow(MembershipError);
  } finally {
    db.close();
  }
});
