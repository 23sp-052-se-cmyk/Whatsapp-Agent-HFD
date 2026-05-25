import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { digestFrequencyEnum } from "./enums";
import { organizations } from "./organizations";
import { members } from "./members";

export const digestSchedules = pgTable("digest_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  memberId: uuid("member_id")
    .notNull()
    .references(() => members.id, { onDelete: "cascade" }),
  frequency: digestFrequencyEnum("frequency").notNull().default("weekly"),
  sendTime: text("send_time").notNull().default("08:00"),
  timezone: text("timezone").notNull().default("Asia/Karachi"),
  recipientPhone: text("recipient_phone"),
  // Delivery channels: email, inapp, whatsapp
  channels: text("channels").array().notNull().default([]),
  lastRunAt: timestamp("last_run_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type DigestSchedule = typeof digestSchedules.$inferSelect;
export type NewDigestSchedule = typeof digestSchedules.$inferInsert;
