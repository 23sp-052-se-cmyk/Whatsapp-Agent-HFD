import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const agentConfigs = pgTable("agent_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  source: text("source").notNull().default("manual"), // "niche_template" | "manual" | "improved"
  nicheTemplateKey: text("niche_template_key"),
  personaJson: jsonb("persona_json").notNull().default({}),
  rulesJson: jsonb("rules_json").notNull().default({}),
  faqs: jsonb("faqs").notNull().default([]),
  replyLangPolicy: text("reply_lang_policy").notNull().default("auto"),
  status: text("status").notNull().default("draft"), // "draft" | "published"
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type AgentConfig = typeof agentConfigs.$inferSelect;
export type NewAgentConfig = typeof agentConfigs.$inferInsert;
