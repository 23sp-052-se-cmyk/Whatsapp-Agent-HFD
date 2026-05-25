import { pgTable, uuid, timestamp, integer } from "drizzle-orm/pg-core";
import { usageKindEnum } from "./enums";
import { organizations } from "./organizations";

export const usageEvents = pgTable("usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  kind: usageKindEnum("kind").notNull(),
  qty: integer("qty").notNull().default(1),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
});

export type UsageEvent = typeof usageEvents.$inferSelect;
export type NewUsageEvent = typeof usageEvents.$inferInsert;
