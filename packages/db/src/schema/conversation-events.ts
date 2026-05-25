import { pgTable, uuid, text, timestamp, real } from "drizzle-orm/pg-core";
import { eventSeverityEnum, eventTypeEnum } from "./enums";
import { organizations } from "./organizations";
import { conversations } from "./conversations";

export const conversationEvents = pgTable("conversation_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  type: eventTypeEnum("type").notNull(),
  severity: eventSeverityEnum("severity").notNull().default("medium"),
  confidence: real("confidence").notNull().default(1.0),
  summary: text("summary"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ConversationEvent = typeof conversationEvents.$inferSelect;
export type NewConversationEvent = typeof conversationEvents.$inferInsert;
