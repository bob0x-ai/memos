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

  const healthFailureThresholdRaw = Number(process.env.MEMOS_GRAPHITI_HEALTH_FAILURE_THRESHOLD || 3);
  const healthFailureThreshold =
    Number.isFinite(healthFailureThresholdRaw) && healthFailureThresholdRaw > 0
      ? Math.floor(healthFailureThresholdRaw)
      : 3;
  const healthCheckIntervalMs = 30000;
  let consecutiveHealthFailures = 0;

  function formatHealthFailureReason(status: {
    status?: number;
    statusText?: string;
    code?: string;
    reason?: string;
  }): string {
    if (status.status) {
      const text = status.statusText ? ` ${status.statusText}` : '';
      return `HTTP ${status.status}${text}`;
    }
    if (status.code) {
      return `${status.code}${status.reason ? ` (${status.reason})` : ''}`;
    }
    return status.reason || 'unknown error';
  }

  async function runHealthCheck(source: 'startup' | 'interval'): Promise<void> {
    const status = await client.healthCheckDetailed();
    graphitiHealth.set(status.healthy ? 1 : 0);

    if (status.healthy) {
      if (consecutiveHealthFailures > 0) {
        logger.info(
          `Graphiti health recovered after ${consecutiveHealthFailures} failed check(s)`
        );
      } else if (source === 'startup') {
        logger.info('Graphiti health check passed at startup');
      }
      consecutiveHealthFailures = 0;
      return;
    }

    consecutiveHealthFailures += 1;
    const reason = formatHealthFailureReason(status);

    if (source === 'startup') {
      logger.warn(`Graphiti server not available at startup (${reason})`);
      return;
    }

    if (consecutiveHealthFailures >= healthFailureThreshold) {
      logger.error(
        `Graphiti server is unhealthy (${consecutiveHealthFailures} consecutive failures, ${reason})`
      );
      return;
    }

    logger.warn(
      `Graphiti health check failed (${consecutiveHealthFailures}/${healthFailureThreshold} before unhealthy, ${reason})`
    );
  }

  // Start health check interval
  const healthCheckInterval = setInterval(async () => {
    try {
      await runHealthCheck('interval');
    } catch (error) {
      logger.error('Unexpected error during Graphiti health check', error);
    }
  }, healthCheckIntervalMs);

  // Initial health check
  runHealthCheck('startup').then(() => {
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
  }).catch(error => {
    logger.error('Startup health check failed unexpectedly', error);
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
