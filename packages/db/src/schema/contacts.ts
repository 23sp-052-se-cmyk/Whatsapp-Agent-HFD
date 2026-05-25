import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { consentStatusEnum } from "./enums";
import { organizations } from "./organizations";
import { channels } from "./channels";

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  channelId: uuid("channel_id").references(() => channels.id, {
    onDelete: "set null",
  }),
  waId: text("wa_id").notNull(),
  name: text("name"),
  attributesJson: jsonb("attributes_json"),
  consentStatus: consentStatusEnum("consent_status")
    .notNull()
    .default("unknown"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
