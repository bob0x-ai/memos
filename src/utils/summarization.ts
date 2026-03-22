import { createHash } from 'crypto';
import {
  summaryCacheHits,
  summaryCacheMisses,
  summaryGenerationDuration,
  summaryGenerationErrors,
  summaryRequests,
} from '../metrics/prometheus';
import { estimateOpenAiCostUsd, observeLlmCall, parseChatCompletionUsage } from '../metrics/llm';
import { isLowSignalFact, isMetaMemoryNoise } from './filter';
import { logger } from './logger';

const DEFAULT_SUMMARIZATION_SYSTEM_PROMPT =
  'You summarize memory facts for executives. Return concise markdown/plain text only, ready to inject directly into chat context. Structure the output with short topic sections using headings like "Topic: <name>" followed by 1-3 concise bullet points. Do not return JSON. Do not include startup/session/bootstrap chatter, self-referential memory-system meta commentary, duplicate points, or source fact IDs. Prefer concrete project/workstream facts over generic statements. If nothing relevant remains, say "No relevant memory signals were found for this query."';

export interface SummaryCandidateFact {
  uuid?: string;
  fact: string;
  importance?: number;
  valid_at?: string;
  created_at?: string;
  _department?: string;
  topicLabel?: string;
}

interface SummaryCacheEntry {
  key: string;
  summaryId: string;
  summary: string;
  sourceFactIds: string[];
  sourceFacts: SummaryCandidateFact[];
  digest: string;
  createdAtMs: number;
  expiresAtMs: number;
}

export interface SummaryResult {
  summaryId: string;
  summary: string;
  sourceFactIds: string[];
  digest: string;
  cacheHit: boolean;
  provider: 'cache' | 'llm' | 'heuristic';
}

export interface SummaryDrillDownData {
  summaryId: string;
  summary: string;
  facts: SummaryCandidateFact[];
  createdAtMs: number;
  expiresAtMs: number;
}

export type SummaryDrillDownLookupResult =
  | { status: 'ok'; data: SummaryDrillDownData }
  | { status: 'expired'; data: SummaryDrillDownData }
  | { status: 'not_found' };

const summaryCache = new Map<string, SummaryCacheEntry>();
const summaryById = new Map<string, SummaryCacheEntry>();

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have', 'how',
  'i', 'if', 'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'our', 'that', 'the',
  'their', 'them', 'there', 'these', 'this', 'to', 'up', 'was', 'we', 'were', 'what',
  'when', 'where', 'which', 'who', 'with', 'you', 'your', 'about', 'after', 'before',
  'during', 'latest', 'today', 'now', 'moving', 'status', 'update', 'updates', 'current',
  'currently', 'recent', 'recently', 'still', 'needs', 'need', 'using', 'used', 'use',
  'runs', 'run', 'works', 'working', 'through',
]);

const BROAD_QUERY_TERMS = new Set([
  'latest', 'today', 'moving', 'status', 'update', 'updates', 'current', 'recent', 'recently',
  'anything', 'new', 'news', 'going', 'what', 'whats',
]);

const GENERIC_TOPIC_TOKENS = new Set([
  'assistant', 'context', 'database', 'generated', 'memory', 'service', 'services',
  'session', 'startup', 'storage', 'system',
]);

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

function safeTimestamp(value?: string): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function rankFacts(facts: SummaryCandidateFact[]): SummaryCandidateFact[] {
  return [...facts].sort((a, b) => {
    const importanceA = typeof a.importance === 'number' ? a.importance : 3;
    const importanceB = typeof b.importance === 'number' ? b.importance : 3;
    if (importanceA !== importanceB) {
      return importanceB - importanceA;
    }
    const recencyA = safeTimestamp(a.valid_at || a.created_at);
    const recencyB = safeTimestamp(b.valid_at || b.created_at);
    return recencyB - recencyA;
  });
}

function buildFactsDigest(facts: SummaryCandidateFact[]): string {
  const canonical = facts.map(f => ({
    id: f.uuid || '',
    fact: f.fact,
    importance: typeof f.importance === 'number' ? f.importance : 3,
    timestamp: f.valid_at || f.created_at || '',
    department: f._department || '',
    topicLabel: f.topicLabel || '',
  }));
  const serialized = JSON.stringify(canonical);
  return createHash('sha256').update(serialized).digest('hex');
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[`"'()[\]{}:;,.!?/\\]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function normalizeFactForDedup(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b(?:a|an|the|is|are|was|were|currently|now|still)\b/g, ' ')
    .replace(/[`"'()[\]{}:;,.!?/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function jaccardSimilarity(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function dedupeNearDuplicateFacts(facts: SummaryCandidateFact[]): SummaryCandidateFact[] {
  const deduped: SummaryCandidateFact[] = [];

  for (const fact of rankFacts(facts)) {
    const normalized = normalizeFactForDedup(fact.fact);
    const normalizedTokens = tokenize(normalized);
    const duplicate = deduped.some((existing) => {
      const existingNormalized = normalizeFactForDedup(existing.fact);
      if (existingNormalized === normalized) {
        return true;
      }
      const existingTokens = tokenize(existingNormalized);
      return jaccardSimilarity(existingTokens, normalizedTokens) >= 0.82;
    });
    if (!duplicate) {
      deduped.push(fact);
    }
  }

  return deduped;
}

function isBroadExecutiveQuery(query: string): boolean {
  const tokens = tokenize(query);
  if (tokens.length === 0) {
    return true;
  }
  return tokens.every((token) => BROAD_QUERY_TERMS.has(token));
}

function scoreFactRelevance(fact: SummaryCandidateFact, query: string): number {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return 0;
  }
  const factTokens = tokenize(fact.fact);
  const overlap = queryTokens.filter((token) => factTokens.includes(token));
  const normalizedQuery = query.toLowerCase();
  const normalizedFact = fact.fact.toLowerCase();
  let score = overlap.length / Math.max(1, Math.min(queryTokens.length, 6));

  if (normalizedQuery.length > 12 && normalizedFact.includes(normalizedQuery)) {
    score += 1;
  }
  for (const token of overlap) {
    if (token.length >= 5) {
      score += 0.1;
    }
  }

  return score;
}

function deriveTopicTokens(fact: SummaryCandidateFact, query: string): string[] {
  const queryTokens = tokenize(query);
  const queryTokenSet = new Set(queryTokens);
  const factTokens = tokenize(fact.fact);
  const overlap = queryTokens.filter((token) => factTokens.includes(token)).slice(0, 3);
  const remaining = factTokens.filter((token) => !queryTokenSet.has(token));
  const tokens = [...overlap, ...remaining];
  const preferred = tokens.filter((token) => !GENERIC_TOPIC_TOKENS.has(token));
  return (preferred.length > 0 ? preferred : tokens).slice(0, 4);
}

function toTopicLabel(tokens: string[]): string {
  if (tokens.length === 0) {
    return 'General Updates';
  }
  return tokens
    .slice(0, 3)
    .map((token) => token.toUpperCase() === token ? token : token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

type SummaryTopicGroup = {
  label: string;
  tokens: string[];
  facts: SummaryCandidateFact[];
  score: number;
};

function buildTopicGroups(
  query: string,
  facts: SummaryCandidateFact[],
  maxTopics: number,
  perTopicLimit: number,
): SummaryTopicGroup[] {
  const broadQuery = isBroadExecutiveQuery(query);
  const groups: SummaryTopicGroup[] = [];

  for (const fact of rankFacts(facts)) {
    const relevance = scoreFactRelevance(fact, query);
    if (!broadQuery && relevance < 0.16) {
      continue;
    }

    const topicTokens = deriveTopicTokens(fact, query);
    const score =
      relevance +
      ((typeof fact.importance === 'number' ? fact.importance : 3) / 10) +
      (safeTimestamp(fact.valid_at || fact.created_at) / 10 ** 14);

    let matchedGroup = groups.find((group) => {
      const overlap = topicTokens.filter((token) => group.tokens.includes(token));
      return overlap.length > 0;
    });

    if (!matchedGroup) {
      matchedGroup = {
        label: fact.topicLabel || toTopicLabel(topicTokens),
        tokens: topicTokens,
        facts: [],
        score: 0,
      };
      groups.push(matchedGroup);
    }

    matchedGroup.facts.push({
      ...fact,
      topicLabel: matchedGroup.label,
    });
    matchedGroup.score = Math.max(matchedGroup.score, score);
  }

  return groups
    .map((group) => ({
      ...group,
      facts: rankFacts(dedupeNearDuplicateFacts(group.facts)).slice(0, perTopicLimit),
    }))
    .filter((group) => group.facts.length > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, maxTopics);
}

export function prepareSummaryCandidates(params: {
  query: string;
  facts: SummaryCandidateFact[];
  maxTopics?: number;
  perTopicLimit?: number;
}): SummaryCandidateFact[] {
  const filtered = params.facts.filter((fact) => {
    const text = String(fact.fact || '').trim();
    return Boolean(text) && !isMetaMemoryNoise(text) && !isLowSignalFact(text);
  });

  const deduped = dedupeNearDuplicateFacts(filtered);
  const groups = buildTopicGroups(
    params.query,
    deduped,
    params.maxTopics ?? 3,
    params.perTopicLimit ?? 4,
  );

  return groups.flatMap((group) =>
    group.facts.map((fact) => ({
      ...fact,
      topicLabel: fact.topicLabel || group.label,
    })),
  );
}

function buildCacheKey(
  query: string,
  departments: string[],
  model: string,
  digest: string
): string {
  const normalizedQuery = normalizeQuery(query);
  const sortedDepartments = [...departments].sort().join(',');
  return `${normalizedQuery}::${sortedDepartments}::${model}::${digest}`;
}

function buildSummaryId(key: string): string {
  return `sum_${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
}

function stripMarkdownFence(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/```(?:markdown|md|text)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim();
  }
  return trimmed;
}

function parseSummaryResponse(raw: string): { summary: string } | null {
  const summary = stripMarkdownFence(raw).trim();
  if (!summary) {
    return null;
  }
  return { summary };
}

function buildHeuristicSummary(
  query: string,
  facts: SummaryCandidateFact[]
): { summary: string; sourceFactIds: string[] } {
  const groupedFacts = prepareSummaryCandidates({
    query,
    facts,
    maxTopics: 3,
    perTopicLimit: 4,
  });
  const rankedFacts = rankFacts(groupedFacts).slice(0, 12);
  if (rankedFacts.length === 0) {
    return {
      summary: 'No relevant memory signals were found for this query.',
      sourceFactIds: [],
    };
  }

  const grouped = new Map<string, SummaryCandidateFact[]>();
  for (const fact of rankedFacts) {
    const label = fact.topicLabel || 'General Updates';
    const bucket = grouped.get(label) || [];
    bucket.push(fact);
    grouped.set(label, bucket);
  }

  const sections = [...grouped.entries()].map(([label, items]) => [
    `Topic: ${label}`,
    ...items.map((fact) => `- ${fact.fact}`),
  ].join('\n'));
  const summary = sections.join('\n\n');

  return {
    summary,
    sourceFactIds: rankedFacts
      .map(f => f.uuid)
      .filter((id): id is string => Boolean(id)),
  };
}

async function summarizeWithLLM(
  query: string,
  facts: SummaryCandidateFact[],
  model: string,
  systemPrompt: string = DEFAULT_SUMMARIZATION_SYSTEM_PROMPT
): Promise<{ summary: string; sourceFactIds: string[] }> {
  if (process.env.NODE_ENV === 'test' && process.env.MEMOS_ENABLE_LLM_IN_TESTS !== 'true') {
    throw new Error('LLM summary disabled in test environment');
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not set');
  }

  const timeoutMs = Number(process.env.MEMOS_SUMMARY_TIMEOUT_MS || 10000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const preparedFacts = prepareSummaryCandidates({
      query,
      facts,
      maxTopics: 3,
      perTopicLimit: 5,
    }).slice(0, 20);
    const candidates = preparedFacts.map((fact, index) => ({
      id: fact.uuid || `fact-${index + 1}`,
      fact: String(fact.fact || '').slice(0, 500),
      importance: typeof fact.importance === 'number' ? fact.importance : 3,
      department: fact._department || '',
      topic: fact.topicLabel || '',
    }));

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 400,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: JSON.stringify({
              query,
              candidates,
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Summary API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };
    const usage = parseChatCompletionUsage(data);
    const content = data.choices?.[0]?.message?.content || '';
    const parsed = parseSummaryResponse(content);
    if (!parsed) {
      throw new Error('Summary model returned empty text');
    }
    observeLlmCall({
      source: 'plugin',
      useCase: 'summarization',
      model,
      status: 'ok',
      durationSeconds: (Date.now() - startedAt) / 1000,
      usage,
      estimatedCostUsd: estimateOpenAiCostUsd(model, usage),
    });
    return {
      summary: parsed.summary,
      sourceFactIds: preparedFacts
        .map((fact) => fact.uuid)
        .filter((id): id is string => Boolean(id)),
    };
  } catch (error) {
    observeLlmCall({
      source: 'plugin',
      useCase: 'summarization',
      model,
      status: 'error',
      durationSeconds: (Date.now() - startedAt) / 1000,
    });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function clearSummaryCache(): void {
  summaryCache.clear();
  summaryById.clear();
}

export function formatSummaryAsContext(summaryId: string, summary: string, sourceFactIds: string[]): string {
  void sourceFactIds;
  return `## Executive Memory Summary\n\nSummary ID: ${summaryId}\n\n${summary}\n`;
}

export function getSummaryDrillDown(
  summaryId: string,
  limit: number = 10
): SummaryDrillDownLookupResult {
  const entry = summaryById.get(summaryId);
  if (!entry) {
    return { status: 'not_found' };
  }

  const data: SummaryDrillDownData = {
    summaryId: entry.summaryId,
    summary: entry.summary,
    facts: entry.sourceFacts.slice(0, Math.max(1, limit)),
    createdAtMs: entry.createdAtMs,
    expiresAtMs: entry.expiresAtMs,
  };

  if (entry.expiresAtMs <= Date.now()) {
    return { status: 'expired', data };
  }

  return {
    status: 'ok',
    data,
  };
}

export async function getOrGenerateSummary(params: {
  query: string;
  departments: string[];
  facts: SummaryCandidateFact[];
  cacheTtlHours: number;
  model: string;
  systemPrompt?: string;
  agentId?: string;
  mode?: 'native_communities' | 'fallback_summaries';
}): Promise<SummaryResult> {
  const agentId = params.agentId || 'unknown';
  const mode = params.mode || 'fallback_summaries';
  summaryRequests.labels(agentId, mode).inc();

  const digest = buildFactsDigest(params.facts);
  const key = buildCacheKey(params.query, params.departments, params.model, digest);
  const summaryId = buildSummaryId(key);
  const now = Date.now();
  const cached = summaryCache.get(key);
  if (cached && cached.expiresAtMs > now) {
    logger.debug(`Summary cache hit (key=${key.slice(0, 16)}...)`);
    summaryCacheHits.labels(agentId).inc();
    summaryGenerationDuration.labels(agentId, 'cache').observe(0);
    summaryById.set(cached.summaryId, cached);
    return {
      summaryId: cached.summaryId,
      summary: cached.summary,
      sourceFactIds: cached.sourceFactIds,
      digest: cached.digest,
      cacheHit: true,
      provider: 'cache',
    };
  }

  summaryCacheMisses.labels(agentId).inc();

  const start = Date.now();
  let generated: { summary: string; sourceFactIds: string[] };
  let provider: 'llm' | 'heuristic' = 'llm';
  try {
    generated = await summarizeWithLLM(
      params.query,
      params.facts,
      params.model,
      params.systemPrompt
    );
  } catch (error) {
    provider = 'heuristic';
    summaryGenerationErrors.labels(agentId, 'llm_unavailable').inc();
    logger.warn('LLM summary generation failed, using heuristic summary fallback', error);
    generated = buildHeuristicSummary(params.query, params.facts);
  }
  summaryGenerationDuration.labels(agentId, provider).observe((Date.now() - start) / 1000);

  const rankedFacts = rankFacts(params.facts);
  const sourceFacts =
    generated.sourceFactIds.length > 0
      ? rankedFacts.filter(f => f.uuid && generated.sourceFactIds.includes(f.uuid))
      : rankedFacts.slice(0, 20);

  const ttlMs = Math.max(1, params.cacheTtlHours) * 60 * 60 * 1000;
  const entry: SummaryCacheEntry = {
    key,
    summaryId,
    summary: generated.summary,
    sourceFactIds: generated.sourceFactIds,
    sourceFacts,
    digest,
    createdAtMs: now,
    expiresAtMs: now + ttlMs,
  };
  summaryCache.set(key, entry);
  summaryById.set(summaryId, entry);

  logger.info(`Summary cache miss -> generated new summary (facts=${params.facts.length})`);
  return {
    summaryId,
    summary: generated.summary,
    sourceFactIds: generated.sourceFactIds,
    digest,
    cacheHit: false,
    provider,
  };
}
