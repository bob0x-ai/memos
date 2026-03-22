import {
  llmDuration,
  llmEstimatedCostUsd,
  llmInputTokens,
  llmOutputTokens,
  llmRequests,
  llmTotalTokens,
  openAiBilledCostUsd,
  openAiReportingErrors,
  openAiReportingLastSuccess,
  openAiUsageInputTokens,
  openAiUsageOutputTokens,
  openAiUsageRequests,
} from './prometheus';
import { logger } from '../utils/logger';

export type LlmProvider = 'openai';
export type LlmSource = 'plugin' | 'graphiti';
export type LlmUseCase =
  | 'summarization'
  | 'classification'
  | 'reranking'
  | 'extraction'
  | 'embedding';

export interface ParsedUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

interface PricingOverrides {
  [model: string]: {
    inputPer1M?: number;
    input_per_1m?: number;
    outputPer1M?: number;
    output_per_1m?: number;
  };
}

export interface LlmObservation {
  provider?: LlmProvider;
  source: LlmSource;
  useCase: LlmUseCase;
  model: string;
  status: 'ok' | 'error';
  durationSeconds: number;
  usage?: ParsedUsage | null;
  estimatedCostUsd?: number | null;
}

export interface ReportingUsageObservation {
  source: LlmSource;
  useCase: Extract<LlmUseCase, 'extraction' | 'embedding'>;
  model: string;
  projectId: string;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
}

export interface ReportingCostObservation {
  source: LlmSource;
  useCase: Extract<LlmUseCase, 'extraction' | 'embedding'>;
  lineItem: string;
  projectId: string;
  amountUsd: number;
}

const DEFAULT_PRICING: Record<string, ModelPricing> = {
  'gpt-4o-mini': {
    inputPer1M: 0.15,
    outputPer1M: 0.6,
  },
  'text-embedding-3-small': {
    inputPer1M: 0.02,
    outputPer1M: 0,
  },
};

function normalizePositiveNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

function normalizeLabel(value: string | null | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized ? normalized : fallback;
}

function loadPricingOverrides(): Record<string, ModelPricing> {
  const raw = process.env.MEMOS_OPENAI_PRICING_JSON;
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as PricingOverrides;
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([model, pricing]) => {
        const inputPer1M = normalizePositiveNumber(pricing.inputPer1M ?? pricing.input_per_1m);
        const outputPer1M = normalizePositiveNumber(pricing.outputPer1M ?? pricing.output_per_1m);
        if (!model || (inputPer1M === 0 && outputPer1M === 0)) {
          return [];
        }
        return [[model, { inputPer1M, outputPer1M }]];
      })
    );
  } catch (error) {
    logger.warn('Failed to parse MEMOS_OPENAI_PRICING_JSON, using built-in pricing only', error);
    return {};
  }
}

export function parseChatCompletionUsage(payload: unknown): ParsedUsage | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const usage = (payload as Record<string, unknown>).usage;
  if (!usage || typeof usage !== 'object') {
    return null;
  }

  const usageRecord = usage as Record<string, unknown>;
  const inputTokens = normalizePositiveNumber(usageRecord.prompt_tokens);
  const outputTokens = normalizePositiveNumber(usageRecord.completion_tokens);
  const totalTokens = normalizePositiveNumber(usageRecord.total_tokens) || inputTokens + outputTokens;

  if (inputTokens === 0 && outputTokens === 0 && totalTokens === 0) {
    return null;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

export function estimateOpenAiCostUsd(model: string, usage: ParsedUsage | null | undefined): number | null {
  if (!usage) {
    return null;
  }

  const overrides = loadPricingOverrides();
  const pricing = overrides[model] || DEFAULT_PRICING[model];
  if (!pricing) {
    return null;
  }

  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPer1M;
  return inputCost + outputCost;
}

export function observeLlmCall(observation: LlmObservation): void {
  const provider = observation.provider || 'openai';
  const model = normalizeLabel(observation.model, 'unknown');

  llmRequests.labels(
    provider,
    observation.source,
    observation.useCase,
    model,
    observation.status
  ).inc();

  llmDuration.labels(
    provider,
    observation.source,
    observation.useCase,
    model
  ).observe(Math.max(0, observation.durationSeconds));

  if (observation.usage) {
    llmInputTokens.labels(provider, observation.source, observation.useCase, model)
      .inc(observation.usage.inputTokens);
    llmOutputTokens.labels(provider, observation.source, observation.useCase, model)
      .inc(observation.usage.outputTokens);
    llmTotalTokens.labels(provider, observation.source, observation.useCase, model)
      .inc(observation.usage.totalTokens);
  }

  if (
    typeof observation.estimatedCostUsd === 'number' &&
    Number.isFinite(observation.estimatedCostUsd) &&
    observation.estimatedCostUsd > 0
  ) {
    llmEstimatedCostUsd.labels(provider, observation.source, observation.useCase, model)
      .inc(observation.estimatedCostUsd);
  }
}

export function observeReportingUsage(observation: ReportingUsageObservation): void {
  const model = normalizeLabel(observation.model, 'unknown');
  const projectId = normalizeLabel(observation.projectId, 'unknown');

  if (observation.inputTokens > 0) {
    openAiUsageInputTokens.labels(observation.source, observation.useCase, model, projectId)
      .inc(observation.inputTokens);
  }
  if (observation.outputTokens > 0) {
    openAiUsageOutputTokens.labels(observation.source, observation.useCase, model, projectId)
      .inc(observation.outputTokens);
  }
  if (observation.requestCount > 0) {
    openAiUsageRequests.labels(observation.source, observation.useCase, model, projectId)
      .inc(observation.requestCount);
  }
}

export function observeReportingCost(observation: ReportingCostObservation): void {
  if (!Number.isFinite(observation.amountUsd) || observation.amountUsd <= 0) {
    return;
  }

  openAiBilledCostUsd.labels(
    observation.source,
    observation.useCase,
    normalizeLabel(observation.lineItem, 'unknown'),
    normalizeLabel(observation.projectId, 'unknown')
  ).inc(observation.amountUsd);
}

export function observeReportingError(endpoint: string, errorType: string): void {
  openAiReportingErrors.labels(
    normalizeLabel(endpoint, 'unknown'),
    normalizeLabel(errorType, 'unknown')
  ).inc();
}

export function markReportingSuccess(epochSeconds: number): void {
  if (Number.isFinite(epochSeconds) && epochSeconds > 0) {
    openAiReportingLastSuccess.set(epochSeconds);
  }
}
