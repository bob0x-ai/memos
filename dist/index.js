"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveDepartment = exports.GraphitiClient = exports.validateConfig = exports.defaultConfig = exports.MemosPlugin = void 0;
const graphiti_client_1 = require("./graphiti-client");
Object.defineProperty(exports, "GraphitiClient", { enumerable: true, get: function () { return graphiti_client_1.GraphitiClient; } });
const config_1 = require("./config");
Object.defineProperty(exports, "defaultConfig", { enumerable: true, get: function () { return config_1.defaultConfig; } });
Object.defineProperty(exports, "validateConfig", { enumerable: true, get: function () { return config_1.validateConfig; } });
const department_1 = require("./utils/department");
Object.defineProperty(exports, "resolveDepartment", { enumerable: true, get: function () { return department_1.resolveDepartment; } });
const capture_1 = require("./hooks/capture");
const recall_1 = require("./hooks/recall");
const recall_2 = require("./tools/recall");
const prometheus_1 = require("./metrics/prometheus");
/**
 * MEMOS Plugin for OpenClaw
 * Graphiti-based memory with temporal tracking and department scoping
 */
class MemosPlugin {
    config;
    client;
    healthCheckInterval;
    constructor(config) {
        // Merge with defaults
        this.config = {
            ...config_1.defaultConfig,
            ...config,
        };
        // Validate configuration
        (0, config_1.validateConfig)(this.config);
        // Initialize Graphiti client
        this.client = new graphiti_client_1.GraphitiClient({
            baseUrl: this.config.graphiti_url,
            timeout: 30000,
        });
        console.log('MEMOS plugin initialized');
    }
    /**
     * Initialize the plugin
     */
    async init() {
        // Start health check interval
        this.healthCheckInterval = setInterval(async () => {
            const healthy = await this.client.healthCheck();
            prometheus_1.graphitiHealth.set(healthy ? 1 : 0);
            if (!healthy) {
                console.error('Graphiti server is unhealthy');
            }
        }, 30000); // Check every 30 seconds
        // Initial health check
        const healthy = await this.client.healthCheck();
        if (!healthy) {
            console.warn('Graphiti server not available at startup');
        }
        console.log('MEMOS plugin ready');
    }
    /**
     * Clean up resources
     */
    async destroy() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }
    }
    /**
     * Hook: before_prompt_build
     * Recall relevant facts before the agent prompt is built
     */
    async beforePromptBuild(event, ctx) {
        try {
            return await (0, recall_1.recallHook)(event, ctx, this.config, this.client);
        }
        catch (error) {
            console.error('Recall hook error:', error);
            prometheus_1.recallErrors.inc({
                department: (0, department_1.resolveDepartment)(ctx.agentId, this.config) || 'unknown',
                error_type: 'hook_error',
            });
            return {};
        }
    }
    /**
     * Hook: agent_end
     * Capture episode after the agent responds
     */
    async agentEnd(event, ctx) {
        try {
            await (0, capture_1.captureHook)(event, ctx, this.config, this.client);
        }
        catch (error) {
            console.error('Capture hook error:', error);
            prometheus_1.captureErrors.inc({
                department: (0, department_1.resolveDepartment)(ctx.agentId, this.config) || 'unknown',
                error_type: 'hook_error',
            });
        }
    }
    /**
     * Tool: memos_recall
     * Explicit memory search
     */
    async memosRecall(params, ctx) {
        return (0, recall_2.memosRecallTool)(params, ctx, this.config, this.client);
    }
    /**
     * Tool: memos_cross_dept
     * Cross-department memory query
     */
    async memosCrossDept(params, ctx) {
        return (0, recall_2.memosCrossDeptTool)(params, ctx, this.config, this.client);
    }
    /**
     * Get Prometheus metrics
     */
    async getMetrics() {
        return (0, prometheus_1.getMetrics)();
    }
    /**
     * Check if Graphiti is healthy
     */
    async healthCheck() {
        return this.client.healthCheck();
    }
}
exports.MemosPlugin = MemosPlugin;
// Default export for OpenClaw
exports.default = MemosPlugin;
//# sourceMappingURL=index.js.map