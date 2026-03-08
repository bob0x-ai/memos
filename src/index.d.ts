import { GraphitiClient } from './graphiti-client';
import { MemosConfig, defaultConfig, validateConfig } from './config';
import { resolveDepartment } from './utils/department';
/**
 * MEMOS Plugin for OpenClaw
 * Graphiti-based memory with temporal tracking and department scoping
 */
export declare class MemosPlugin {
    private config;
    private client;
    private healthCheckInterval?;
    constructor(config: MemosConfig);
    /**
     * Initialize the plugin
     */
    init(): Promise<void>;
    /**
     * Clean up resources
     */
    destroy(): Promise<void>;
    /**
     * Hook: before_prompt_build
     * Recall relevant facts before the agent prompt is built
     */
    beforePromptBuild(event: unknown, ctx: {
        agentId: string;
        messages: Array<{
            role: string;
            content: string;
        }>;
    }): Promise<{
        prependSystemContext?: string;
    }>;
    /**
     * Hook: agent_end
     * Capture episode after the agent responds
     */
    agentEnd(event: unknown, ctx: {
        agentId: string;
        messages: Array<{
            role: string;
            content: string;
        }>;
        userId?: string;
        sessionId?: string;
        channel?: string;
    }): Promise<void>;
    /**
     * Tool: memos_recall
     * Explicit memory search
     */
    memosRecall(params: {
        query: string;
        limit?: number;
    }, ctx: {
        agentId: string;
    }): Promise<unknown>;
    /**
     * Tool: memos_cross_dept
     * Cross-department memory query
     */
    memosCrossDept(params: {
        department: string;
        query: string;
        limit?: number;
    }, ctx: {
        agentId: string;
    }): Promise<unknown>;
    /**
     * Get Prometheus metrics
     */
    getMetrics(): Promise<string>;
    /**
     * Check if Graphiti is healthy
     */
    healthCheck(): Promise<boolean>;
}
export { MemosConfig, defaultConfig, validateConfig, GraphitiClient, resolveDepartment, };
export default MemosPlugin;
//# sourceMappingURL=index.d.ts.map