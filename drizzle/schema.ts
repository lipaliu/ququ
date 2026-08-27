import {
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const corpusSources = mysqlTable("corpus_sources", {
  id: int("id").autoincrement().primaryKey(),
  sourceKey: varchar("source_key", { length: 80 }).notNull().unique(),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  originalSha256: varchar("original_sha256", { length: 64 }).notNull(),
  originalByteCount: int("original_byte_count").notNull(),
  expectedLogicalLineCount: int("expected_logical_line_count").notNull(),
  processedLineCount: int("processed_line_count").notNull().default(0),
  blankLineCount: int("blank_line_count").notNull().default(0),
  status: mysqlEnum("status", ["pending", "processing", "completed", "failed"]).notNull().default("pending"),
  processingNote: text("processing_note"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const corpusVersions = mysqlTable("corpus_versions", {
  id: int("id").autoincrement().primaryKey(),
  versionKey: varchar("version_key", { length: 80 }).notNull().unique(),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  isDefaultLearningVersion: boolean("is_default_learning_version").notNull().default(false),
  processingStatus: mysqlEnum("processing_status", ["draft", "ready", "active", "archived"]).notNull().default("draft"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const corpusVersionSources = mysqlTable("corpus_version_sources", {
  id: int("id").autoincrement().primaryKey(),
  versionId: int("version_id").notNull(),
  sourceId: int("source_id").notNull(),
  sourceAlias: varchar("source_alias", { length: 120 }).notNull(),
  sourceFileName: varchar("source_file_name", { length: 255 }).notNull(),
  sourceSha256: varchar("source_sha256", { length: 64 }).notNull(),
  sourceOrder: int("source_order").notNull(),
  mappingMethod: mysqlEnum("mapping_method", ["ingested", "verified_reuse"]).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("corpus_version_source_alias_unique").on(table.versionId, table.sourceAlias),
  index("corpus_version_sources_order_idx").on(table.versionId, table.sourceOrder),
]);

export const corpusLines = mysqlTable("corpus_lines", {
  id: int("id").autoincrement().primaryKey(),
  sourceId: int("source_id").notNull(),
  lineNumber: int("line_number").notNull(),
  lineText: text("line_text").notNull(),
  lineHash: varchar("line_hash", { length: 64 }).notNull(),
  isBlank: boolean("is_blank").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("corpus_lines_source_line_unique").on(table.sourceId, table.lineNumber),
  index("corpus_lines_source_order_idx").on(table.sourceId, table.lineNumber),
]);

export const corpusSections = mysqlTable("corpus_sections", {
  id: int("id").autoincrement().primaryKey(),
  sourceId: int("source_id").notNull(),
  parentSectionId: int("parent_section_id"),
  title: text("title").notNull(),
  sectionKind: mysqlEnum("section_kind", ["source_root", "detected_chapter", "detected_section"]).notNull(),
  startLine: int("start_line").notNull(),
  endLine: int("end_line").notNull(),
  detectionMethod: varchar("detection_method", { length: 80 }).notNull(),
  reviewStatus: mysqlEnum("review_status", ["approved", "needs_review", "rejected"]).notNull().default("needs_review"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("corpus_sections_source_range_idx").on(table.sourceId, table.startLine, table.endLine),
]);

export const corpusPassages = mysqlTable("corpus_passages", {
  id: int("id").autoincrement().primaryKey(),
  sourceId: int("source_id").notNull(),
  sectionId: int("section_id").notNull(),
  passageNumber: int("passage_number").notNull(),
  startLine: int("start_line").notNull(),
  endLine: int("end_line").notNull(),
  lineCount: int("line_count").notNull(),
  passageText: text("passage_text").notNull(),
  segmentationMethod: varchar("segmentation_method", { length: 80 }).notNull(),
  annotationJson: json("annotation_json"),
  annotationStatus: mysqlEnum("annotation_status", ["generated", "reviewed", "rejected"]).notNull().default("generated"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("corpus_passages_source_number_unique").on(table.sourceId, table.passageNumber),
  index("corpus_passages_source_range_idx").on(table.sourceId, table.startLine, table.endLine),
  index("corpus_passages_section_idx").on(table.sectionId),
]);

export const knowledgeEntries = mysqlTable("knowledge_entries", {
  id: int("id").autoincrement().primaryKey(),
  category: mysqlEnum("category", ["expression", "rhythm", "judgment", "questioning", "case", "boundary", "safety"]).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  summary: text("summary").notNull(),
  evidenceJson: json("evidence_json").notNull(),
  occurrenceCount: int("occurrence_count").notNull().default(1),
  reviewStatus: mysqlEnum("review_status", ["pending", "approved", "needs_revision", "rejected"]).notNull().default("pending"),
  reviewerNote: text("reviewer_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("knowledge_entries_category_review_idx").on(table.category, table.reviewStatus),
]);

export const reviewItems = mysqlTable("review_items", {
  id: int("id").autoincrement().primaryKey(),
  category: mysqlEnum("category", ["expression", "framework", "followup", "case", "boundary", "safety"]).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content").notNull(),
  evidenceJson: json("evidence_json").notNull(),
  status: mysqlEnum("status", ["pending", "approved", "needs_revision", "rejected"]).notNull().default("pending"),
  reviewerNote: text("reviewer_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const corpusUnits = mysqlTable("corpus_units", {
  id: int("id").autoincrement().primaryKey(),
  sourceId: int("source_id").notNull(),
  sectionId: int("section_id").notNull(),
  passageId: int("passage_id").notNull(),
  unitNumber: int("unit_number").notNull(),
  startLine: int("start_line").notNull(),
  endLine: int("end_line").notNull(),
  unitText: text("unit_text").notNull(),
  unitKind: mysqlEnum("unit_kind", ["assertion", "story", "question", "strategy", "risk", "mixed"]).notNull().default("mixed"),
  topicJson: json("topic_json").notNull(),
  expressionHitsJson: json("expression_hits_json").notNull(),
  caseType: mysqlEnum("case_type", ["none", "relationship", "communication", "decision", "financial", "other"]).notNull().default("none"),
  boundaryTagsJson: json("boundary_tags_json").notNull(),
  annotationStatus: mysqlEnum("annotation_status", ["generated", "reviewed", "rejected"]).notNull().default("generated"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("corpus_units_source_number_unique").on(table.sourceId, table.unitNumber),
  index("corpus_units_source_range_idx").on(table.sourceId, table.startLine, table.endLine),
  index("corpus_units_passage_idx").on(table.passageId),
]);

export const conversations = mysqlTable("conversations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id"),
  title: varchar("title", { length: 255 }).notNull(),
  scenario: mysqlEnum("scenario", ["relationship", "communication", "decision", "general"]).notNull().default("general"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("conversations_user_updated_idx").on(table.userId, table.updatedAt),
]);

export const chatMessages = mysqlTable("chat_messages", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversation_id").notNull(),
  role: mysqlEnum("role", ["user", "assistant", "system"]).notNull(),
  content: text("content").notNull(),
  riskLevel: mysqlEnum("risk_level", ["normal", "elevated", "high"]).notNull().default("normal"),
  citationsJson: json("citations_json"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("chat_messages_conversation_order_idx").on(table.conversationId, table.createdAt),
]);
