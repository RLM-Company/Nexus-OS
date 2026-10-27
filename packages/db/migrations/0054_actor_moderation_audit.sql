CREATE TABLE identity_actor_moderations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  target_actor_id TEXT NOT NULL,
  performed_by TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('suspend','restore')),
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 8 AND 256),
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX actor_moderation_owner ON identity_actor_moderations(owner_id,created_at);
--> statement-breakpoint
CREATE TRIGGER actor_moderation_no_update BEFORE UPDATE ON identity_actor_moderations BEGIN
  SELECT RAISE(ABORT,'SECURITY_AUDIT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER actor_moderation_no_delete BEFORE DELETE ON identity_actor_moderations BEGIN
  SELECT RAISE(ABORT,'SECURITY_AUDIT_IMMUTABLE');
END;
