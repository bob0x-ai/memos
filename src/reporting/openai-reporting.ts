import {
  markReportingSuccess,
  observeReportingCost,
  observeReportingError,
  observeReportingUsage,
} from '../metrics/llm';
import { logger } from '../utils/logger';

export interface OpenAiReportingConfig {
  enabled: boolean;
  adminKey: string | null;
  graphitiProjectId: string | null;
  intervalSeconds: number;
  baseUrl: string;
}

export interface OpenAiReportingState {
  lastSuccessfulEndTime: number | null;
  seenUsageKeys: Map<string, number>;
  seenCostKeys: Map<string, number>;
}

interface OpenAiBucketResult {
  startTime: number;
  endTime: number;
  result: Record<string, unknown>;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_INTERVAL_SECONDS = 300;
const DEFAULT_STARTUP_LOOKBACK_SECONDS = 900;
const DEFAULT_OVERLAP_SECONDS = 60;
const DEFAULT_PRUNE_AGE_SECONDS = 3 * 24 * 60 * 60;

function parseBooleanEnv(value: string | undefined): boolean | null {
  if (value === undefined) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return null;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function appendList(params: URLSearchParams, key: string, values: string[]): void {
  for (const value of values) {
    if (value) {
      params.append(key, value);
    }
  }
}

function safeString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}

function safeNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

function buildParams(input: Record<string, string | number | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      appendList(params, key, value);
      continue;
    }
    params.set(key, String(value));
  }
  return params;
}

function createBucketResults(data: unknown): OpenAiBucketResult[] {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.flatMap((bucket) => {
    if (!bucket || typeof bucket !== 'object') {
      return [];
    }
    const record = bucket as Record<string, unknown>;
    const startTime = safeNumber(record.start_time);
    const endTime = safeNumber(record.end_time);
    const results = Array.isArray(record.results) ? record.results : [];

    return results.flatMap((result) => {
      if (!result || typeof result !== 'object') {
        return [];
      }
      return [{
        startTime,
        endTime,
        result: result as Record<string, unknown>,
      }];
    });
  });
}

function pruneSeenKeys(store: Map<string, number>, minTimestamp: number): void {
  for (const [key, timestamp] of store.entries()) {
    if (timestamp < minTimestamp) {
      store.delete(key);
    }
  }
}

async function fetchAllBuckets(
  config: OpenAiReportingConfig,
  path: string,
  params: URLSearchParams
): Promise<OpenAiBucketResult[]> {
  if (!config.adminKey) {
    return [];
  }

  const allBuckets: OpenAiBucketResult[] = [];
  let page: string | null = null;

  do {
    const pageParams = new URLSearchParams(params);
    if (page) {
      pageParams.set('page', page);
    }

    try {
      const response = await fetch(`${config.baseUrl}${path}?${pageParams.toString()}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${config.adminKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const body = (await response.text()).slice(0, 1000);
        const error = new Error(`OpenAI reporting error ${response.status} ${response.statusText}${body ? ` - ${body}` : ''}`);
        observeReportingError(path, `http_${response.status}`);
        throw error;
      }

      const payload = await response.json() as { data?: unknown; next_page?: unknown };
      allBuckets.push(...createBucketResults(payload.data));
      page = typeof payload.next_page === 'string' && payload.next_page ? payload.next_page : null;
    } catch (error) {
      if (!(error instanceof Error && error.message.startsWith('OpenAI reporting error '))) {
        observeReportingError(path, 'request_failed');
      }
      throw error;
    }
  } while (page);

  return allBuckets;
}

function usageKey(path: string, bucket: OpenAiBucketResult): string {
  return [
    path,
    bucket.startTime,
    bucket.endTime,
    safeString(bucket.result.project_id, 'unknown'),
    safeString(bucket.result.model, 'unknown'),
    safeString(bucket.result.api_key_id, 'unknown'),
  ].join(':');
}

function costKey(bucket: OpenAiBucketResult): string {
  return [
    bucket.startTime,
    bucket.endTime,
    safeString(bucket.result.project_id, 'unknown'),
    safeString(bucket.result.line_item, 'unknown'),
    safeNumber((bucket.result.amount as Record<string, unknown> | undefined)?.value),
  ].join(':');
}

function getUseCaseForPath(path: string): 'extraction' | 'embedding' {
  return path.includes('embeddings') ? 'embedding' : 'extraction';
}

function getUseCaseForCost(lineItem: unknown): 'extraction' | 'embedding' {
  const normalized = typeof lineItem === 'string' ? lineItem.toLowerCase() : '';
  return normalized.includes('embedding') ? 'embedding' : 'extraction';
}

function getBucketWindow(state: OpenAiReportingState, config: OpenAiReportingConfig): {
  startTime: number;
  endTime: number;
  overlapSeconds: number;
} {
  const endTime = Math.floor(Date.now() / 1000);
  const overlapSeconds = Math.min(DEFAULT_OVERLAP_SECONDS, config.intervalSeconds);
  const baseStart = state.lastSuccessfulEndTime === null
    ? endTime - DEFAULT_STARTUP_LOOKBACK_SECONDS
    : state.lastSuccessfulEndTime - overlapSeconds;

  return {
    startTime: Math.max(0, baseStart),
    endTime,
    overlapSeconds,
  };
}

export function getOpenAiReportingConfig(): OpenAiReportingConfig {
  const adminKey = process.env.OPENAI_ADMIN_KEY?.trim() || null;
  const graphitiProjectId = process.env.MEMOS_OPENAI_GRAPHITI_PROJECT_ID?.trim() || null;
  const explicitEnabled = parseBooleanEnv(process.env.MEMOS_OPENAI_REPORTING_ENABLED);
  const enabled = explicitEnabled ?? Boolean(adminKey && graphitiProjectId);

  return {
    enabled,
    adminKey,
    graphitiProjectId,
    intervalSeconds: parsePositiveInteger(
      process.env.MEMOS_OPENAI_REPORTING_INTERVAL_SECONDS,
      DEFAULT_INTERVAL_SECONDS
    ),
    baseUrl: process.env.MEMOS_OPENAI_REPORTING_BASE_URL?.trim() || DEFAULT_BASE_URL,
  };
}

export function createOpenAiReportingState(): OpenAiReportingState {
  return {
    lastSuccessfulEndTime: null,
    seenUsageKeys: new Map<string, number>(),
    seenCostKeys: new Map<string, number>(),
  };
}

export async function pollOpenAiReporting(
  config: OpenAiReportingConfig,
  state: OpenAiReportingState
): Promise<void> {
  if (!config.enabled || !config.adminKey || !config.graphitiProjectId) {
    return;
  }

  const { startTime, endTime, overlapSeconds } = getBucketWindow(state, config);
  const usageParams = buildParams({
    start_time: startTime,
    end_time: endTime,
    bucket_width: '1m',
    limit: 1440,
    group_by: ['project_id', 'model', 'api_key_id'],
    project_ids: [config.graphitiProjectId],
  });

  const costParams = buildParams({
    start_time: Math.max(0, startTime - 86400),
    end_time: endTime,
    bucket_width: '1d',
    limit: 31,
    group_by: ['line_item', 'project_id'],
    project_ids: [config.graphitiProjectId],
  });

  const [completionBuckets, embeddingBuckets, costBuckets] = await Promise.all([
    fetchAllBuckets(config, '/organization/usage/completions', usageParams),
    fetchAllBuckets(config, '/organization/usage/embeddings', usageParams),
    fetchAllBuckets(config, '/organization/costs', costParams),
  ]);

  for (const [path, buckets] of [
    ['/organization/usage/completions', completionBuckets],
    ['/organization/usage/embeddings', embeddingBuckets],
  ] as const) {
    for (const bucket of buckets) {
      const projectId = safeString(bucket.result.project_id, 'unknown');
      if (projectId !== config.graphitiProjectId) {
        continue;
      }

      const dedupeKey = usageKey(path, bucket);
      if (state.seenUsageKeys.has(dedupeKey)) {
        continue;
      }
      state.seenUsageKeys.set(dedupeKey, bucket.endTime);

      observeReportingUsage({
        source: 'graphiti',
        useCase: getUseCaseForPath(path),
        model: safeString(bucket.result.model, 'unknown'),
        projectId,
        inputTokens: safeNumber(bucket.result.input_tokens),
        outputTokens: safeNumber(bucket.result.output_tokens),
        requestCount: safeNumber(bucket.result.num_model_requests),
      });
    }
  }

  for (const bucket of costBuckets) {
    const projectId = safeString(bucket.result.project_id, 'unknown');
    if (projectId !== config.graphitiProjectId) {
      continue;
    }

    const dedupeKey = costKey(bucket);
    if (state.seenCostKeys.has(dedupeKey)) {
      continue;
    }
    state.seenCostKeys.set(dedupeKey, bucket.endTime);

    observeReportingCost({
      source: 'graphiti',
      useCase: getUseCaseForCost(bucket.result.line_item),
      lineItem: safeString(bucket.result.line_item, 'unknown'),
      projectId,
      amountUsd: safeNumber((bucket.result.amount as Record<string, unknown> | undefined)?.value),
    });
  }

  state.lastSuccessfulEndTime = endTime;
  markReportingSuccess(endTime);
  pruneSeenKeys(state.seenUsageKeys, startTime - DEFAULT_PRUNE_AGE_SECONDS - overlapSeconds);
  pruneSeenKeys(state.seenCostKeys, startTime - DEFAULT_PRUNE_AGE_SECONDS - overlapSeconds);
}

export function startOpenAiReporting(): NodeJS.Timeout | null {
  const config = getOpenAiReportingConfig();
  if (!config.enabled) {
    logger.info('OpenAI reporting poller disabled');
    return null;
  }

  if (!config.adminKey) {
    logger.warn('OpenAI reporting poller enabled but OPENAI_ADMIN_KEY is not set');
    return null;
  }

  if (!config.graphitiProjectId) {
    logger.warn('OpenAI reporting poller enabled but MEMOS_OPENAI_GRAPHITI_PROJECT_ID is not set');
    return null;
  }

  const state = createOpenAiReportingState();
  const runPoll = async (source: 'startup' | 'interval'): Promise<void> => {
    try {
      await pollOpenAiReporting(config, state);
      if (source === 'startup') {
        logger.info(`OpenAI reporting poller started for Graphiti project ${config.graphitiProjectId}`);
      }
    } catch (error) {
      logger.warn('OpenAI reporting poll failed', error);
    }
  };

  void runPoll('startup');
  return setInterval(() => {
    void runPoll('interval');
  }, config.intervalSeconds * 1000);
}
