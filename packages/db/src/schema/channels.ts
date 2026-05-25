import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { channelProviderEnum, channelStatusEnum } from "./enums";
import { organizations } from "./organizations";

export const channels = pgTable("channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  provider: channelProviderEnum("provider").notNull().default("baileys"),
  phone: text("phone").notNull(),
  status: channelStatusEnum("status").notNull().default("disconnected"),
  // Encrypted reference to credentials in the secrets store (never raw creds here)
  credentialsRef: text("credentials_ref"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Channel = typeof channels.$inferSelect;
export type NewChannel = typeof channels.$inferInsert;
