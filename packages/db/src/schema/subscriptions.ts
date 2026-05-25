import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { planEnum, subscriptionStatusEnum } from "./enums";
import { organizations } from "./organizations";

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  plan: planEnum("plan").notNull().default("starter"),
  status: subscriptionStatusEnum("status").notNull().default("trialing"),
  currentPeriodStart: timestamp("current_period_start").notNull(),
  currentPeriodEnd: timestamp("current_period_end").notNull(),
  stripeRef: text("stripe_ref"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
