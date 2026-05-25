import { pgEnum } from "drizzle-orm/pg-core";

// Organization
export const planEnum = pgEnum("plan", [
  "starter",
  "growth",
  "pro",
  "enterprise",
]);
export const orgStatusEnum = pgEnum("org_status", [
  "active",
  "suspended",
  "deleted",
]);

// Member
export const memberRoleEnum = pgEnum("member_role", [
  "owner",
  "admin",
  "agent",
  "viewer",
]);
export const memberStatusEnum = pgEnum("member_status", [
  "active",
  "invited",
  "suspended",
]);

// Channel
export const channelProviderEnum = pgEnum("channel_provider", [
  "baileys",
  "cloud_api",
]);
export const channelStatusEnum = pgEnum("channel_status", [
  "connected",
  "disconnected",
  "degraded",
  "rate_limited",
  "banned",
  "reconnecting",
]);

// Contact
export const consentStatusEnum = pgEnum("consent_status", [
  "unknown",
  "opted_in",
  "opted_out",
]);

// Conversation
export const conversationStateEnum = pgEnum("conversation_state", [
  "open",
  "resolved",
  "archived",
]);
export const aiModeEnum = pgEnum("ai_mode", ["auto", "paused", "off"]);

// Message
export const messageDirectionEnum = pgEnum("message_direction", [
  "inbound",
  "outbound",
]);
export const messageTypeEnum = pgEnum("message_type", [
  "text",
  "audio",
  "image",
  "video",
  "document",
  "template",
  "system",
]);
export const messageStatusEnum = pgEnum("message_status", [
  "pending",
  "sent",
  "delivered",
  "read",
  "failed",
]);

// Knowledge Base
export const kbSourceTypeEnum = pgEnum("kb_source_type", [
  "pdf",
  "docx",
  "txt",
  "url",
  "csv",
  "faq",
  "manual",
]);
export const kbStatusEnum = pgEnum("kb_status", [
  "pending",
  "processing",
  "ready",
  "failed",
]);

// Review
export const reviewVerdictEnum = pgEnum("review_verdict", [
  "thumbs_up",
  "thumbs_down",
]);
export const reviewStatusEnum = pgEnum("review_status", [
  "pending",
  "curated",
  "dismissed",
]);

// Events & Notifications
export const eventTypeEnum = pgEnum("event_type", [
  "sale",
  "critical",
  "handoff",
  "at_risk",
  "complaint",
  "competitor_mention",
]);
export const eventSeverityEnum = pgEnum("event_severity", [
  "low",
  "medium",
  "high",
  "critical",
]);
export const digestFrequencyEnum = pgEnum("digest_frequency", [
  "daily",
  "weekly",
  "monthly",
]);
export const notifStatusEnum = pgEnum("notif_status", [
  "pending",
  "sent",
  "failed",
]);

// Usage & Billing
export const usageKindEnum = pgEnum("usage_kind", [
  "message",
  "ai_token",
  "stt_minute",
  "channel",
]);
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "past_due",
  "canceled",
  "trialing",
]);
