import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { GraphitiClient } from './graphiti-client';
import { MemosConfig, defaultConfig, validateConfig } from './config';
import { resolveDepartment } from './utils/department';
import { captureHook } from './hooks/capture';
import { recallHook } from './hooks/recall';
import { memosRecallTool, memosCrossDeptTool } from './tools/recall';
import {
  graphitiHealth,
  getMetrics,
} from './metrics/prometheus';

/**
 * MEMOS Plugin for OpenClaw
 * Graphiti-based memory with temporal tracking and department scoping
 */
export function createPlugin(config: MemosConfig) {
  // Merge with defaults
  const pluginConfig = {
    ...defaultConfig,
    ...config,
  } as MemosConfig;

  // Validate configuration
  validateConfig(pluginConfig);

  // Initialize Graphiti client
  const client = new GraphitiClient({
    baseUrl: pluginConfig.graphiti_url,
    timeout: 30000,
  });

  console.log('MEMOS plugin initialized');

  // Start health check interval
  const healthCheckInterval = setInterval(async () => {
    const healthy = await client.healthCheck();
    graphitiHealth.set(healthy ? 1 : 0);
    
    if (!healthy) {
      console.error('Graphiti server is unhealthy');
    }
  }, 30000); // Check every 30 seconds

  // Initial health check
  client.healthCheck().then(healthy => {
    if (!healthy) {
      console.warn('Graphiti server not available at startup');
    }
    console.log('MEMOS plugin ready');
  });

  return {
    id: "memos",
    name: "MEMOS - Graphiti Memory Plugin",
    description: "Knowledge graph-based memory with temporal tracking and department scoping",
    register(api: OpenClawPluginApi) {
      if (pluginConfig.auto_recall) {
        api.on("before_agent_start", async (event, ctx) => {
          try {
            const result = await recallHook({}, ctx, pluginConfig, client);
            if (result.prependSystemContext) {
              return { prependContext: result.prependSystemContext };
            }
          } catch (error) {
            console.error('Recall hook error:', error);
          }
          return;
        });
      }

      if (pluginConfig.auto_capture) {
        api.on("agent_end", async (event, ctx) => {
          try {
            await captureHook({}, ctx, pluginConfig, client);
          } catch (error) {
            console.error('Capture hook error:', error);
          }
        });
      }

      // memos_recall tool
      api.registerTool({
        name: 'memos_recall',
        description: 'Search for facts in the current agent\'s department memory',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max results' }
          },
          required: ['query'],
        },
        handler: memosRecallTool as any,
      });

      // memos_cross_dept tool
      api.registerTool({
        name: 'memos_cross_dept',
        description: 'Query another department\'s memory',
        parameters: {
          type: 'object',
          properties: {
            department: { type: 'string', description: 'Target department' },
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max results' }
          },
          required: ['department', 'query'],
        },
        handler: memosCrossDeptTool as any,
      });
    },
    shutdown: () => {
      clearInterval(healthCheckInterval);
      console.log('MEMOS plugin shutdown');
    }
  };
}

export type { MemosConfig };
export { defaultConfig, validateConfig, GraphitiClient, resolveDepartment };

export default createPlugin;
