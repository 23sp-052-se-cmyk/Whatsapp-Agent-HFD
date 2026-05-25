import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { knowledgeItems } from "./knowledge-items";

export const knowledgeChunks = pgTable("knowledge_chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  knowledgeItemId: uuid("knowledge_item_id")
    .notNull()
    .references(() => knowledgeItems.id, { onDelete: "cascade" }),
  // ID of the corresponding vector in the tenant-namespaced vector store
  vectorId: text("vector_id"),
  text: text("text").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type KnowledgeChunk = typeof knowledgeChunks.$inferSelect;
export type NewKnowledgeChunk = typeof knowledgeChunks.$inferInsert;
