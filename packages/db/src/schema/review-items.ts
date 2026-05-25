import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { reviewStatusEnum, reviewVerdictEnum } from "./enums";
import { organizations } from "./organizations";
import { messages } from "./messages";

export const reviewItems = pgTable("review_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  messageId: uuid("message_id")
    .notNull()
    .references(() => messages.id, { onDelete: "cascade" }),
  verdict: reviewVerdictEnum("verdict").notNull(),
  correctionText: text("correction_text"),
  status: reviewStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ReviewItem = typeof reviewItems.$inferSelect;
export type NewReviewItem = typeof reviewItems.$inferInsert;
