import {
  pgTable,
  uuid,
  timestamp,
  integer,
  real,
  jsonb,
  text,
} from "drizzle-orm/pg-core";
import { eventTypeEnum } from "./enums";
import { organizations } from "./organizations";
import { members } from "./members";

export const notificationRules = pgTable("notification_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  eventType: eventTypeEnum("event_type").notNull(),
  // Delivery channels: inapp, email, whatsapp
  channels: text("channels").array().notNull().default([]),
  threshold: real("threshold").notNull().default(0.7),
  quietHours: jsonb("quiet_hours"),
  targetMemberId: uuid("target_member_id").references(() => members.id, {
    onDelete: "set null",
  }),
  dedupeWindow: integer("dedupe_window").notNull().default(3600),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type NotificationRule = typeof notificationRules.$inferSelect;
export type NewNotificationRule = typeof notificationRules.$inferInsert;
