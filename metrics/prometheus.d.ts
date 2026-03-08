import { Counter, Histogram, Gauge } from 'prom-client';
/**
 * Prometheus metrics for MEMOS plugin
 */
export declare const episodesCaptured: Counter<"department" | "agent_id">;
export declare const episodesFiltered: Counter<"department">;
export declare const captureDuration: Histogram<"department">;
export declare const captureErrors: Counter<"department" | "error_type">;
export declare const recallOperations: Counter<"department" | "agent_id">;
export declare const recallResults: Histogram<"department">;
export declare const recallDuration: Histogram<"department">;
export declare const recallErrors: Counter<"department" | "error_type">;
export declare const toolCalls: Counter<"department" | "tool">;
export declare const toolErrors: Counter<"department" | "tool">;
export declare const graphitiHealth: Gauge<string>;
export declare const crossDeptQueries: Counter<"source_dept" | "target_dept">;
/**
 * Get all metrics in Prometheus format
 * @returns Metrics string
 */
export declare function getMetrics(): Promise<string>;
/**
 * Reset all metrics (useful for testing)
 */
export declare function resetMetrics(): void;
//# sourceMappingURL=prometheus.d.ts.map