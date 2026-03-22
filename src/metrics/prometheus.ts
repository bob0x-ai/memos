import { Counter, Histogram, Gauge, register } from 'prom-client';

/**
 * Prometheus metrics for MEMOS plugin
 */

// Episode capture metrics
export const episodesCaptured = new Counter({
  name: 'memos_episodes_captured_total',
  help: 'Total number of episodes captured',
  labelNames: ['department', 'agent_id'],
});

export const episodesFiltered = new Counter({
  name: 'memos_episodes_filtered_total',
  help: 'Total number of episodes filtered as trivial',
  labelNames: ['department'],
});

export const captureDuration = new Histogram({
  name: 'memos_capture_duration_seconds',
  help: 'Duration of episode capture operations',
  labelNames: ['department'],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
});

export const captureErrors = new Counter({
  name: 'memos_capture_errors_total',
  help: 'Total number of capture errors',
  labelNames: ['department', 'error_type'],
});

// Recall metrics
export const recallOperations = new Counter({
  name: 'memos_recall_operations_total',
  help: 'Total number of recall operations',
  labelNames: ['department', 'agent_id'],
});

export const recallResults = new Histogram({
  name: 'memos_recall_results_count',
  help: 'Number of results returned from recall',
  labelNames: ['department'],
  buckets: [0, 1, 2, 5, 10, 20],
});

export const recallDuration = new Histogram({
  name: 'memos_recall_duration_seconds',
  help: 'Duration of recall operations',
  labelNames: ['department'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2],
});

export const recallErrors = new Counter({
  name: 'memos_recall_errors_total',
  help: 'Total number of recall errors',
  labelNames: ['department', 'error_type'],
});

// Tool usage metrics
export const toolCalls = new Counter({
  name: 'memos_tool_calls_total',
  help: 'Total number of tool calls',
  labelNames: ['tool', 'department'],
});

export const toolErrors = new Counter({
  name: 'memos_tool_errors_total',
  help: 'Total number of tool call errors',
  labelNames: ['tool', 'department'],
});

// Graphiti health
export const graphitiHealth = new Gauge({
  name: 'memos_graphiti_health',
  help: 'Graphiti server health (1 = healthy, 0 = unhealthy)',
});

export const backendRequests = new Counter({
  name: 'memos_backend_requests_total',
  help: 'Graphiti backend operations by backend and outcome',
  labelNames: ['operation', 'backend', 'outcome'],
});

// Cross-department queries
export const crossDeptQueries = new Counter({
  name: 'memos_cross_dept_queries_total',
  help: 'Total number of cross-department queries',
  labelNames: ['source_dept', 'target_dept'],
});

// Summarization metrics
export const summaryRequests = new Counter({
  name: 'memos_summary_requests_total',
  help: 'Total number of summary-generation requests',
  labelNames: ['agent_id', 'mode'],
});

export const summaryCacheHits = new Counter({
  name: 'memos_summary_cache_hits_total',
  help: 'Total number of summary cache hits',
  labelNames: ['agent_id'],
});

export const summaryCacheMisses = new Counter({
  name: 'memos_summary_cache_misses_total',
  help: 'Total number of summary cache misses',
  labelNames: ['agent_id'],
});

export const summaryGenerationDuration = new Histogram({
  name: 'memos_summary_generation_duration_seconds',
  help: 'Duration of summary generation',
  labelNames: ['agent_id', 'provider'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
});

export const summaryGenerationErrors = new Counter({
  name: 'memos_summary_generation_errors_total',
  help: 'Total number of summary generation errors',
  labelNames: ['agent_id', 'error_type'],
});

export const summaryModeSelections = new Counter({
  name: 'memos_summary_mode_total',
  help: 'Number of summary mode selections',
  labelNames: ['mode'],
});

export const summaryRetrievalOutcomes = new Counter({
  name: 'memos_summary_retrieval_outcomes_total',
  help: 'Summary retrieval outcomes by agent and pass result',
  labelNames: ['agent_id', 'outcome'],
});

export const summaryRetrievalSources = new Counter({
  name: 'memos_summary_retrieval_sources_total',
  help: 'Summary retrieval source and outcome by agent',
  labelNames: ['agent_id', 'source', 'outcome'],
});

// Drill-down metrics
export const drillDownCalls = new Counter({
  name: 'memos_drill_down_calls_total',
  help: 'Total number of summary drill-down calls',
  labelNames: ['agent_id', 'outcome'],
});

export const drillDownErrors = new Counter({
  name: 'memos_drill_down_errors_total',
  help: 'Total number of summary drill-down errors',
  labelNames: ['agent_id', 'error_type'],
});

export const drillDownDuration = new Histogram({
  name: 'memos_drill_down_duration_seconds',
  help: 'Duration of summary drill-down requests',
  labelNames: ['agent_id', 'outcome'],
  buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1, 2],
});

// LLM metrics for direct plugin-side calls
export const llmRequests = new Counter({
  name: 'memos_llm_requests_total',
  help: 'Total number of direct LLM requests made by MEMOS',
  labelNames: ['provider', 'source', 'use_case', 'model', 'status'],
});

export const llmInputTokens = new Counter({
  name: 'memos_llm_input_tokens_total',
  help: 'Total input tokens used by direct MEMOS LLM calls',
  labelNames: ['provider', 'source', 'use_case', 'model'],
});

export const llmOutputTokens = new Counter({
  name: 'memos_llm_output_tokens_total',
  help: 'Total output tokens used by direct MEMOS LLM calls',
  labelNames: ['provider', 'source', 'use_case', 'model'],
});

export const llmTotalTokens = new Counter({
  name: 'memos_llm_total_tokens_total',
  help: 'Total tokens used by direct MEMOS LLM calls',
  labelNames: ['provider', 'source', 'use_case', 'model'],
});

export const llmDuration = new Histogram({
  name: 'memos_llm_duration_seconds',
  help: 'Duration of direct MEMOS LLM calls',
  labelNames: ['provider', 'source', 'use_case', 'model'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20],
});

export const llmEstimatedCostUsd = new Counter({
  name: 'memos_llm_estimated_cost_usd_total',
  help: 'Estimated USD cost for direct MEMOS LLM calls',
  labelNames: ['provider', 'source', 'use_case', 'model'],
});

// OpenAI organization reporting metrics
export const openAiUsageInputTokens = new Counter({
  name: 'memos_openai_usage_input_tokens_total',
  help: 'Total input tokens reported by the OpenAI usage API',
  labelNames: ['source', 'use_case', 'model', 'project_id'],
});

export const openAiUsageOutputTokens = new Counter({
  name: 'memos_openai_usage_output_tokens_total',
  help: 'Total output tokens reported by the OpenAI usage API',
  labelNames: ['source', 'use_case', 'model', 'project_id'],
});

export const openAiUsageRequests = new Counter({
  name: 'memos_openai_usage_requests_total',
  help: 'Total model requests reported by the OpenAI usage API',
  labelNames: ['source', 'use_case', 'model', 'project_id'],
});

export const openAiBilledCostUsd = new Counter({
  name: 'memos_openai_billed_cost_usd_total',
  help: 'Total billed USD cost reported by the OpenAI costs API',
  labelNames: ['source', 'use_case', 'line_item', 'project_id'],
});

export const openAiReportingLastSuccess = new Gauge({
  name: 'memos_openai_reporting_last_success_timestamp_seconds',
  help: 'Unix timestamp of the last successful OpenAI reporting poll',
});

export const openAiReportingErrors = new Counter({
  name: 'memos_openai_reporting_errors_total',
  help: 'Total OpenAI reporting API polling errors',
  labelNames: ['endpoint', 'error_type'],
});

/**
 * Get all metrics in Prometheus format
 * @returns Metrics string
 */
export async function getMetrics(): Promise<string> {
  return register.metrics();
}

/**
 * Reset all metrics (useful for testing)
 */
export function resetMetrics(): void {
  register.resetMetrics();
}
