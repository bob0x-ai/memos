import { GraphitiClient } from './graphiti-client';
import { MemosConfig, defaultConfig, validateConfig } from './config';
import { resolveDepartment } from './utils/department';
import { captureHook } from './hooks/capture';
import { recallHook } from './hooks/recall';
import { memosRecallTool, memosCrossDeptTool, toolDefinitions } from './tools/recall';
import {
  episodesCaptured,
  episodesFiltered,
  captureErrors,
  recallErrors,
  graphitiHealth,
  getMetrics,
} from './metrics/prometheus';

/**
 * MEMOS Plugin for OpenClaw
 * Graphiti-based memory with temporal tracking and department scoping
 */
export class MemosPlugin {
  private config: MemosConfig;
  private client: GraphitiClient;
  private healthCheckInterval?: NodeJS.Timeout;

  constructor(config: MemosConfig) {
    // Merge with defaults
    this.config = {
      ...defaultConfig,
      ...config,
    } as MemosConfig;

    // Validate configuration
    validateConfig(this.config);

    // Initialize Graphiti client
    this.client = new GraphitiClient({
      baseUrl: this.config.graphiti_url,
      timeout: 30000,
    });

    console.log('MEMOS plugin initialized');
  }

  /**
   * Initialize the plugin
   */
  async init(): Promise<void> {
    // Start health check interval
    this.healthCheckInterval = setInterval(async () => {
      const healthy = await this.client.healthCheck();
      graphitiHealth.set(healthy ? 1 : 0);
      
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
  async destroy(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
  }

  /**
   * Hook: before_prompt_build
   * Recall relevant facts before the agent prompt is built
   */
  async beforePromptBuild(event: unknown, ctx: {
    agentId: string;
    messages: Array<{ role: string; content: string }>;
  }): Promise<{ prependSystemContext?: string }> {
    try {
      return await recallHook(event, ctx, this.config, this.client);
    } catch (error) {
      console.error('Recall hook error:', error);
      recallErrors.inc({
        department: resolveDepartment(ctx.agentId, this.config) || 'unknown',
        error_type: 'hook_error',
      });
      return {};
    }
  }

  /**
   * Hook: agent_end
   * Capture episode after the agent responds
   */
  async agentEnd(event: unknown, ctx: {
    agentId: string;
    messages: Array<{ role: string; content: string }>;
    userId?: string;
    sessionId?: string;
    channel?: string;
  }): Promise<void> {
    try {
      await captureHook(event, ctx, this.config, this.client);
    } catch (error) {
      console.error('Capture hook error:', error);
      captureErrors.inc({
        department: resolveDepartment(ctx.agentId, this.config) || 'unknown',
        error_type: 'hook_error',
      });
    }
  }

  /**
   * Tool: memos_recall
   * Explicit memory search
   */
  async memosRecall(params: { query: string; limit?: number }, ctx: {
    agentId: string;
  }): Promise<unknown> {
    return memosRecallTool(params, ctx, this.config, this.client);
  }

  /**
   * Tool: memos_cross_dept
   * Cross-department memory query
   */
  async memosCrossDept(params: { department: string; query: string; limit?: number }, ctx: {
    agentId: string;
  }): Promise<unknown> {
    return memosCrossDeptTool(params, ctx, this.config, this.client);
  }

  /**
   * Get Prometheus metrics
   */
  async getMetrics(): Promise<string> {
    return getMetrics();
  }

  /**
   * Check if Graphiti is healthy
   */
  async healthCheck(): Promise<boolean> {
    return this.client.healthCheck();
  }
}

// Export types and utilities for external use
export {
  MemosConfig,
  defaultConfig,
  validateConfig,
  GraphitiClient,
  resolveDepartment,
};

// Default export for OpenClaw
export default MemosPlugin;
