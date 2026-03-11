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
