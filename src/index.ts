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
  memosAnnounceTool,
  memosBroadcastTool,
  memorySearchTool,
  memoryStoreTool,
} from './tools/recall';
import {
  graphitiHealth,
  getMetrics,
} from './metrics/prometheus';
import { logger } from './utils/logger';
import { ensureBundledMemorySkillInstalled } from './utils/skill-installer';

type HookMessage = {
  role: string;
  content: string;
};

function normalizeHookMessages(messages: unknown[] | undefined): HookMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.flatMap((message) => {
    if (!message || typeof message !== 'object') {
      return [];
    }

    const raw = message as {
      role?: unknown;
      content?: unknown;
      text?: unknown;
    };

    const role = typeof raw.role === 'string' ? raw.role : null;
    if (!role) {
      return [];
    }

    let content = '';
    if (typeof raw.content === 'string') {
      content = raw.content;
    } else if (typeof raw.text === 'string') {
      content = raw.text;
    } else if (Array.isArray(raw.content)) {
      content = raw.content
        .map((part) => {
          if (typeof part === 'string') {
            return part;
          }
          if (part && typeof part === 'object' && 'text' in part) {
            const text = (part as { text?: unknown }).text;
            return typeof text === 'string' ? text : '';
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');
    }

    const trimmed = content.trim();
    if (!trimmed) {
      return [];
    }

    return [{ role, content: trimmed }];
  });
}

function startPlugin(pluginConfig: MemosConfig, api: OpenClawPluginApi): void {
  // Merge with defaults
  // Initialize Graphiti client
  const client = new GraphitiClient({
    baseUrl: pluginConfig.graphiti_url,
    timeout: 30000,
  });

  logger.info('Plugin initialized');
  ensureBundledMemorySkillInstalled()
    .then(result => {
      if (result.status === 'unchanged') {
        logger.debug(`Bundled memory skill already up to date at ${result.targetPath}`);
      } else {
        logger.info(`Bundled memory skill ${result.status} at ${result.targetPath}`);
      }
    })
    .catch(error => {
      logger.warn('Failed to install bundled memory skill into ~/.openclaw/skills', error);
    });

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

  if (pluginConfig.auto_recall) {
    api.on("before_prompt_build", async (event, ctx) => {
      try {
        const hookEvent = event as { messages?: unknown[] };
        const result = await recallHook(
          {},
          {
            ...ctx,
            messages: normalizeHookMessages(hookEvent.messages),
          },
          pluginConfig,
          client
        );
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
        const hookEvent = event as { messages?: unknown[] };
        await captureHook(
          {},
          {
            ...ctx,
            messages: normalizeHookMessages(hookEvent.messages),
          },
          pluginConfig,
          client
        );
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

  // memos_announce tool
  api.registerTool({
    name: 'memos_announce',
    description: 'Publish deliberate team announcement to caller department with restricted access (management/confidential only)',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Announcement text to publish' },
        content_type: { type: 'string', description: 'Optional content type override (default: decision)' },
        importance: { type: 'integer', minimum: 1, maximum: 5, description: 'Optional importance override (default: 4)' }
      },
      required: ['text'],
    },
    handler: memosAnnounceTool as any,
  });

  // memos_broadcast tool
  api.registerTool({
    name: 'memos_broadcast',
    description: 'Publish deliberate company-wide broadcast to company channel with public access (management/confidential only)',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Broadcast text to publish' },
        content_type: { type: 'string', description: 'Optional content type override (default: decision)' },
        importance: { type: 'integer', minimum: 1, maximum: 5, description: 'Optional importance override (default: 4)' }
      },
      required: ['text'],
    },
    handler: memosBroadcastTool as any,
  });

  // Keep the interval reachable to prevent it from being optimized away.
  void healthCheckInterval;
  void getMetrics;
}

function resolvePluginConfig(api: OpenClawPluginApi): MemosConfig {
  const pluginApi = api as OpenClawPluginApi & { pluginConfig?: Record<string, unknown> };
  const pluginConfig = {
    ...defaultConfig,
    ...(pluginApi.pluginConfig || {}),
  } as MemosConfig;
  validateConfig(pluginConfig);
  return pluginConfig;
}

/**
 * MEMOS Plugin for OpenClaw
 * Graphiti-based memory with temporal tracking and department scoping
 */
export function createPlugin() {
  return {
    id: "memos",
    name: "MEMOS - Graphiti Memory Plugin",
    description: "Knowledge graph-based memory with temporal tracking and department scoping",
    register(api: OpenClawPluginApi) {
      const pluginConfig = resolvePluginConfig(api);
      startPlugin(pluginConfig, api);
    },
  };
}

export type { MemosConfig };
export { defaultConfig, validateConfig, GraphitiClient, resolveDepartment };

export default createPlugin();
