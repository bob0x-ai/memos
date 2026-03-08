"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.crossDeptQueries = exports.graphitiHealth = exports.toolErrors = exports.toolCalls = exports.recallErrors = exports.recallDuration = exports.recallResults = exports.recallOperations = exports.captureErrors = exports.captureDuration = exports.episodesFiltered = exports.episodesCaptured = void 0;
exports.getMetrics = getMetrics;
exports.resetMetrics = resetMetrics;
const prom_client_1 = require("prom-client");
/**
 * Prometheus metrics for MEMOS plugin
 */
// Episode capture metrics
exports.episodesCaptured = new prom_client_1.Counter({
    name: 'memos_episodes_captured_total',
    help: 'Total number of episodes captured',
    labelNames: ['department', 'agent_id'],
});
exports.episodesFiltered = new prom_client_1.Counter({
    name: 'memos_episodes_filtered_total',
    help: 'Total number of episodes filtered as trivial',
    labelNames: ['department'],
});
exports.captureDuration = new prom_client_1.Histogram({
    name: 'memos_capture_duration_seconds',
    help: 'Duration of episode capture operations',
    labelNames: ['department'],
    buckets: [0.1, 0.5, 1, 2, 5, 10],
});
exports.captureErrors = new prom_client_1.Counter({
    name: 'memos_capture_errors_total',
    help: 'Total number of capture errors',
    labelNames: ['department', 'error_type'],
});
// Recall metrics
exports.recallOperations = new prom_client_1.Counter({
    name: 'memos_recall_operations_total',
    help: 'Total number of recall operations',
    labelNames: ['department', 'agent_id'],
});
exports.recallResults = new prom_client_1.Histogram({
    name: 'memos_recall_results_count',
    help: 'Number of results returned from recall',
    labelNames: ['department'],
    buckets: [0, 1, 2, 5, 10, 20],
});
exports.recallDuration = new prom_client_1.Histogram({
    name: 'memos_recall_duration_seconds',
    help: 'Duration of recall operations',
    labelNames: ['department'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2],
});
exports.recallErrors = new prom_client_1.Counter({
    name: 'memos_recall_errors_total',
    help: 'Total number of recall errors',
    labelNames: ['department', 'error_type'],
});
// Tool usage metrics
exports.toolCalls = new prom_client_1.Counter({
    name: 'memos_tool_calls_total',
    help: 'Total number of tool calls',
    labelNames: ['tool', 'department'],
});
exports.toolErrors = new prom_client_1.Counter({
    name: 'memos_tool_errors_total',
    help: 'Total number of tool call errors',
    labelNames: ['tool', 'department'],
});
// Graphiti health
exports.graphitiHealth = new prom_client_1.Gauge({
    name: 'memos_graphiti_health',
    help: 'Graphiti server health (1 = healthy, 0 = unhealthy)',
});
// Cross-department queries
exports.crossDeptQueries = new prom_client_1.Counter({
    name: 'memos_cross_dept_queries_total',
    help: 'Total number of cross-department queries',
    labelNames: ['source_dept', 'target_dept'],
});
/**
 * Get all metrics in Prometheus format
 * @returns Metrics string
 */
async function getMetrics() {
    return prom_client_1.register.metrics();
}
/**
 * Reset all metrics (useful for testing)
 */
function resetMetrics() {
    prom_client_1.register.resetMetrics();
}
//# sourceMappingURL=prometheus.js.map