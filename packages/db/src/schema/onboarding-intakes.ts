import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const onboardingIntakes = pgTable("onboarding_intakes", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  nicheTemplateKey: text("niche_template_key").notNull(),
  answersJson: jsonb("answers_json").notNull().default({}),
  importedMaterialRefs: jsonb("imported_material_refs").notNull().default([]), // array of knowledge item references/IDs
  status: text("status").notNull().default("in_progress"), // e.g., 'in_progress', 'completed'
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type OnboardingIntake = typeof onboardingIntakes.$inferSelect;
export type NewOnboardingIntake = typeof onboardingIntakes.$inferInsert;
