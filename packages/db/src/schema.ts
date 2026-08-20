import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const systemMetadata = sqliteTable("nexus_system_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull()
});
