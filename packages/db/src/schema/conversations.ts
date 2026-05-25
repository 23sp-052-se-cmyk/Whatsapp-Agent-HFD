import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { aiModeEnum, conversationStateEnum } from "./enums";
import { organizations } from "./organizations";
import { channels } from "./channels";
import { contacts } from "./contacts";
import { members } from "./members";

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  channelId: uuid("channel_id")
    .notNull()
    .references(() => channels.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  state: conversationStateEnum("state").notNull().default("open"),
  pipelineStage: text("pipeline_stage").notNull().default("new"),
  assignedMemberId: uuid("assigned_member_id").references(() => members.id, {
    onDelete: "set null",
  }),
  aiMode: aiModeEnum("ai_mode").notNull().default("auto"),
  lastMsgAt: timestamp("last_msg_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
