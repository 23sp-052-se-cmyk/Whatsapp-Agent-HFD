import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";

// Global table (no org_id) - authored content
export const nicheTemplates = pgTable("niche_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(), // e.g. "coaching_academic"
  displayName: text("display_name").notNull(),
  version: integer("version").notNull().default(1),
  bodyJson: jsonb("body_json").notNull().default({}),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type NicheTemplate = typeof nicheTemplates.$inferSelect;
export type NewNicheTemplate = typeof nicheTemplates.$inferInsert;
