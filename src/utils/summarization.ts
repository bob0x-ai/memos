import { createHash } from 'crypto';
import {
  summaryCacheHits,
  summaryCacheMisses,
  summaryGenerationDuration,
  summaryGenerationErrors,
  summaryRequests,
} from '../metrics/prometheus';
import { estimateOpenAiCostUsd, observeLlmCall, parseChatCompletionUsage } from '../metrics/llm';
import { logger } from './logger';

const DEFAULT_SUMMARIZATION_SYSTEM_PROMPT =
  'You summarize memory facts for executives. Return strict JSON only: {"summary":"...","highlights":["..."],"risks":["..."],"source_fact_ids":["..."]}.';

export interface SummaryCandidateFact {
  uuid?: string;
  fact: string;
  importance?: number;
  valid_at?: string;
  created_at?: string;
  _department?: string;
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
  }));
  const serialized = JSON.stringify(canonical);
  return createHash('sha256').update(serialized).digest('hex');
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

function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) {
    return fenceMatch[1];
  }
  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  return objectMatch?.[0] || null;
}

function parseSummaryResponse(raw: string): { summary: string; sourceFactIds: string[] } | null {
  const jsonCandidate = extractJsonObject(raw);
  if (!jsonCandidate) {
    return null;
  }
  try {
    const parsed = JSON.parse(jsonCandidate) as Record<string, unknown>;
    const summary = String(parsed.summary || '').trim();
    if (!summary) {
      return null;
    }
    const sourceFactIds = Array.isArray(parsed.source_fact_ids)
      ? parsed.source_fact_ids.map(String)
      : [];
    return { summary, sourceFactIds };
  } catch {
    return null;
  }
}

function buildHeuristicSummary(
  query: string,
  facts: SummaryCandidateFact[]
): { summary: string; sourceFactIds: string[] } {
  const rankedFacts = rankFacts(facts).slice(0, 8);
  if (rankedFacts.length === 0) {
    return {
      summary: 'No relevant memory signals were found for this query.',
      sourceFactIds: [],
    };
  }

  const lines = rankedFacts.map(f => `- ${f.fact}`);
  const summary = [
    `Query focus: ${query}`,
    'Key signals:',
    ...lines,
  ].join('\n');

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
    const candidates = rankFacts(facts).slice(0, 20).map((fact, index) => ({
      id: fact.uuid || `fact-${index + 1}`,
      fact: String(fact.fact || '').slice(0, 500),
      importance: typeof fact.importance === 'number' ? fact.importance : 3,
      department: fact._department || '',
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
      throw new Error('Summary model returned invalid JSON');
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
    return parsed;
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
  const sourceLine =
    sourceFactIds.length > 0
      ? `\n\nSource facts: ${sourceFactIds.slice(0, 10).join(', ')}`
      : '';
  return `## Executive Memory Summary\n\nSummary ID: ${summaryId}\n\n${summary}${sourceLine}\n`;
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
