import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { notifStatusEnum } from "./enums";
import { organizations } from "./organizations";
import { notificationRules } from "./notification-rules";
import { conversationEvents } from "./conversation-events";

export const notificationLogs = pgTable("notification_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  ruleId: uuid("rule_id").references(() => notificationRules.id, {
    onDelete: "set null",
  }),
  eventId: uuid("event_id").references(() => conversationEvents.id, {
    onDelete: "set null",
  }),
  channel: text("channel").notNull(),
  status: notifStatusEnum("status").notNull().default("pending"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type NotificationLog = typeof notificationLogs.$inferSelect;
export type NewNotificationLog = typeof notificationLogs.$inferInsert;
