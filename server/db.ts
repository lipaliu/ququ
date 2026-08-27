import { and, asc, desc, eq, gte, like, lte, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  chatMessages,
  conversations,
  corpusLines,
  corpusPassages,
  corpusSections,
  corpusSources,
  corpusUnits,
  knowledgeEntries,
  reviewItems,
  type InsertUser,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  for (const field of ["name", "email", "loginMethod"] as const) {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }
  values.lastSignedIn = user.lastSignedIn ?? new Date();
  updateSet.lastSignedIn = values.lastSignedIn;
  values.role = user.role ?? (user.openId === ENV.ownerOpenId ? "admin" : "user");
  updateSet.role = values.role;
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

function requireDb<T>(db: T | null): T {
  if (!db) throw new Error("知识库暂不可用，请稍后重试。");
  return db;
}

export async function getCorpusOverview() {
  const db = requireDb(await getDb());
  const [sources, reviews, expressions, sections] = await Promise.all([
    db.select().from(corpusSources).orderBy(asc(corpusSources.id)),
    db.select().from(reviewItems).orderBy(desc(reviewItems.updatedAt)),
    db.select().from(knowledgeEntries).where(eq(knowledgeEntries.category, "expression")).orderBy(desc(knowledgeEntries.occurrenceCount)),
    db.select().from(corpusSections).where(eq(corpusSections.reviewStatus, "needs_review")).orderBy(asc(corpusSections.sourceId), asc(corpusSections.startLine)),
  ]);
  return { sources, reviews, expressions, sections };
}

export async function updateReviewItem(input: { id: number; status: "approved" | "needs_revision" | "rejected"; reviewerNote?: string }) {
  const db = requireDb(await getDb());
  await db.update(reviewItems).set({ status: input.status, reviewerNote: input.reviewerNote?.trim() || null }).where(eq(reviewItems.id, input.id));
  const updated = await db.select().from(reviewItems).where(eq(reviewItems.id, input.id)).limit(1);
  return updated[0];
}

export async function updateSectionReview(input: { id: number; status: "approved" | "rejected" }) {
  const db = requireDb(await getDb());
  await db.update(corpusSections).set({ reviewStatus: input.status }).where(eq(corpusSections.id, input.id));
  const updated = await db.select().from(corpusSections).where(eq(corpusSections.id, input.id)).limit(1);
  return updated[0];
}

export async function getSourceLines(input: { sourceId: number; startLine: number; endLine: number }) {
  const db = requireDb(await getDb());
  return db.select().from(corpusLines).where(and(
    eq(corpusLines.sourceId, input.sourceId),
    gte(corpusLines.lineNumber, input.startLine),
    lte(corpusLines.lineNumber, input.endLine),
  )).orderBy(asc(corpusLines.lineNumber));
}

export async function getSectionsForSource(sourceId: number) {
  const db = requireDb(await getDb());
  return db.select().from(corpusSections).where(eq(corpusSections.sourceId, sourceId)).orderBy(asc(corpusSections.startLine));
}

export async function getSectionContent(sectionId: number) {
  const db = requireDb(await getDb());
  const section = await db.select().from(corpusSections).where(eq(corpusSections.id, sectionId)).limit(1);
  if (!section[0]) return undefined;
  const passages = await db.select().from(corpusPassages).where(eq(corpusPassages.sectionId, sectionId)).orderBy(asc(corpusPassages.passageNumber));
  return { section: section[0], passages };
}

export async function getPassageContent(passageId: number) {
  const db = requireDb(await getDb());
  const passage = await db.select().from(corpusPassages).where(eq(corpusPassages.id, passageId)).limit(1);
  if (!passage[0]) return undefined;
  const units = await db.select().from(corpusUnits).where(eq(corpusUnits.passageId, passageId)).orderBy(asc(corpusUnits.unitNumber));
  return { passage: passage[0], units };
}

export async function createConversation(input: { userId: number; title: string; scenario: "relationship" | "communication" | "decision" | "general" }) {
  const db = requireDb(await getDb());
  const result = await db.insert(conversations).values(input);
  const created = await db.select().from(conversations).where(eq(conversations.id, Number(result[0].insertId))).limit(1);
  return created[0];
}

export async function listConversations(userId: number) {
  const db = requireDb(await getDb());
  return db.select().from(conversations).where(eq(conversations.userId, userId)).orderBy(desc(conversations.updatedAt));
}

export async function getConversation(conversationId: number, userId: number) {
  const db = requireDb(await getDb());
  const result = await db.select().from(conversations).where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId))).limit(1);
  return result[0];
}

export async function listChatMessages(conversationId: number) {
  const db = requireDb(await getDb());
  return db.select().from(chatMessages).where(eq(chatMessages.conversationId, conversationId)).orderBy(asc(chatMessages.createdAt));
}

export async function appendChatMessage(input: {
  conversationId: number;
  role: "user" | "assistant" | "system";
  content: string;
  riskLevel: "normal" | "elevated" | "high";
  citationsJson?: unknown;
}) {
  const db = requireDb(await getDb());
  const result = await db.insert(chatMessages).values(input);
  await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, input.conversationId));
  const created = await db.select().from(chatMessages).where(eq(chatMessages.id, Number(result[0].insertId))).limit(1);
  return created[0];
}

export async function getApprovedReviewItems() {
  const db = requireDb(await getDb());
  return db.select().from(reviewItems).where(eq(reviewItems.status, "approved")).orderBy(asc(reviewItems.id));
}

const TOPIC_TERMS = ["关系", "沟通", "边界", "婚姻", "恋爱", "分手", "相亲", "前任", "出轨", "结婚", "选择", "工作", "价值", "付出", "需求"];

export async function findRelevantPassages(query: string) {
  const db = requireDb(await getDb());
  const matches = TOPIC_TERMS.filter((term) => query.includes(term)).slice(0, 3);
  if (!matches.length) return [];
  const predicates = matches.map((term) => like(corpusPassages.passageText, `%${term}%`));
  return db.select().from(corpusPassages).where(or(...predicates)).orderBy(asc(corpusPassages.sourceId), asc(corpusPassages.startLine)).limit(3);
}
