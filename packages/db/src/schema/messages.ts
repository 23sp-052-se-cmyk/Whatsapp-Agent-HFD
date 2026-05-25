import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { messageDirectionEnum, messageStatusEnum, messageTypeEnum } from "./enums";
import { organizations } from "./organizations";
import { conversations } from "./conversations";

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  direction: messageDirectionEnum("direction").notNull(),
  type: messageTypeEnum("type").notNull().default("text"),
  body: text("body"),
  mediaRef: text("media_ref"),
  transcript: text("transcript"),
  detectedLang: text("detected_lang"),
  waMessageId: text("wa_message_id"),
  status: messageStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
