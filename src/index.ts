import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { GraphitiClient } from './graphiti-client';
import { MemosConfig, defaultConfig, validateConfig } from './config';
import { resolveDepartment } from './utils/department';
import { captureHook } from './hooks/capture';
import { recallHook } from './hooks/recall';
import {
  memosRecallTool,
  memosCrossDeptTool,
  memosDrillDownTool,
  memorySearchTool,
  memoryStoreTool,
} from './tools/recall';
import {
  graphitiHealth,
  getMetrics,
} from './metrics/prometheus';
import { logger } from './utils/logger';

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

  logger.info('Plugin initialized');

  // Start health check interval
  const healthCheckInterval = setInterval(async () => {
    const healthy = await client.healthCheck();
    graphitiHealth.set(healthy ? 1 : 0);
    
    if (!healthy) {
      logger.error('Graphiti server is unhealthy');
    }
  }, 30000); // Check every 30 seconds

  // Initial health check
  client.healthCheck().then(healthy => {
    if (!healthy) {
      logger.warn('Graphiti server not available at startup');
    }
    client.detectCapabilities().then(capabilities => {
      logger.info(
        `Graphiti capability mode: ${capabilities.mode} ` +
        `(community_endpoints=${capabilities.hasCommunityEndpoints}, ` +
        `update_communities_flag=${capabilities.supportsUpdateCommunitiesFlag})`
      );
    }).catch(error => {
      logger.warn('Graphiti capability detection failed', error);
    });
    logger.info('Plugin ready');
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
            logger.error('Recall hook error', error);
          }
          return;
        });
      }

      if (pluginConfig.auto_capture) {
        api.on("agent_end", async (event, ctx) => {
          try {
            await captureHook({}, ctx, pluginConfig, client);
          } catch (error) {
            logger.error('Capture hook error', error);
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

      // memos_drill_down tool
      api.registerTool({
        name: 'memos_drill_down',
        description: 'Retrieve detailed facts behind a summary ID',
        parameters: {
          type: 'object',
          properties: {
            summary_id: { type: 'string', description: 'Summary ID to drill into' },
            limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max detail facts' }
          },
          required: ['summary_id'],
        },
        handler: memosDrillDownTool as any,
      });

      // memory_search tool (compat alias)
      api.registerTool({
        name: 'memory_search',
        description: 'Search memory explicitly',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max results' }
          },
          required: ['query'],
        },
        handler: memorySearchTool as any,
      });

      // memory_store tool
      api.registerTool({
        name: 'memory_store',
        description: 'Store a fact or memory explicitly',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Memory text to store' },
            content_type: { type: 'string', description: 'Optional content type override' },
            importance: { type: 'integer', minimum: 1, maximum: 5, description: 'Optional importance override' },
            access_level: { type: 'string', description: 'Optional access level override' }
          },
          required: ['text'],
        },
        handler: memoryStoreTool as any,
      });
    },
    getMetrics: () => getMetrics(),
    shutdown: () => {
      clearInterval(healthCheckInterval);
      logger.info('Plugin shutdown');
    }
  };
}

export type { MemosConfig };
export { defaultConfig, validateConfig, GraphitiClient, resolveDepartment };

export default createPlugin;
