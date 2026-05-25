import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { memberRoleEnum, memberStatusEnum } from "./enums";
import { organizations } from "./organizations";

export const members = pgTable("members", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  passwordHash: text("password_hash"),
  role: memberRoleEnum("role").notNull().default("agent"),
  status: memberStatusEnum("status").notNull().default("invited"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Member = typeof members.$inferSelect;
export type NewMember = typeof members.$inferInsert;
