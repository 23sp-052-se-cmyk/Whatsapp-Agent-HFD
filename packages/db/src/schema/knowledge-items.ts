import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { kbSourceTypeEnum, kbStatusEnum } from "./enums";
import { organizations } from "./organizations";

export const knowledgeItems = pgTable("knowledge_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  sourceType: kbSourceTypeEnum("source_type").notNull(),
  title: text("title").notNull(),
  storageRef: text("storage_ref"),
  status: kbStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type KnowledgeItem = typeof knowledgeItems.$inferSelect;
export type NewKnowledgeItem = typeof knowledgeItems.$inferInsert;
