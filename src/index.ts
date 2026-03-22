import type { OpenClawPluginApi, OpenClawPluginToolContext } from "openclaw/plugin-sdk";
import type { IncomingMessage, ServerResponse } from "node:http";
import { GraphitiClient } from './graphiti-client';
import { MemosConfig, defaultConfig, validateConfig } from './config';
import { resolveDepartment } from './utils/department';
import { captureHook } from './hooks/capture';
import { recallHook } from './hooks/recall';
import {
  isContextVisibilityEnabledForHook,
  postVisibleContextMonitor,
  resolveConversationKeysFromCommand,
  setContextVisibility,
} from './context-visibility';
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
import { startOpenAiReporting } from './reporting/openai-reporting';
import { logger } from './utils/logger';
import { ensureBundledMemorySkillInstalled } from './utils/skill-installer';

type HookMessage = {
  role: string;
  content: string;
};

type ToolRuntimeContext = {
  agentId: string;
  userId?: string;
  sessionId?: string;
  sessionKey?: string;
};

function buildToolRuntimeContext(ctx: OpenClawPluginToolContext): ToolRuntimeContext {
  return {
    agentId: ctx.agentId || 'unknown',
    userId: ctx.requesterSenderId,
    sessionId: ctx.sessionId,
    sessionKey: (ctx as { sessionKey?: string }).sessionKey,
  };
}

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
    mcpUrl: pluginConfig.graphiti_mcp_url,
    backend: pluginConfig.graphiti_backend,
    enableRestFallback: pluginConfig.graphiti_enable_rest_fallback,
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
  const openAiReportingInterval = startOpenAiReporting();

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
        const contextVisibilityEnabled = await isContextVisibilityEnabledForHook(api, ctx as any);
        if (contextVisibilityEnabled && result.monitorAttempted) {
          const monitorText = result.prependSystemContext
            ? `MEMOS Context\n\n${result.prependSystemContext}`
            : 'MEMOS Context\n\nNo relevant context found.';
          await postVisibleContextMonitor(api, ctx as any, monitorText);
        }
        if (result.prependSystemContext) {
          return { prependSystemContext: result.prependSystemContext };
        }
      } catch (error) {
        logger.error('Recall hook error', error);
      }
      return;
    });
  }

  api.registerCommand({
    name: 'memos',
    description: 'Toggle visible MEMOS context monitoring for this conversation',
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx: any) => {
      const args = (ctx.args || '').trim().toLowerCase();
      const conversationKeys = resolveConversationKeysFromCommand(ctx);
      if (conversationKeys.length === 0) {
        return {
          text: 'MEMOS could not identify this conversation. Try again from a routable chat thread.',
          isError: true,
        };
      }

      if (args === 'context on') {
        await setContextVisibility(api, conversationKeys, true);
        return { text: 'MEMOS context monitoring is now on for this conversation.' };
      }

      if (args === 'context off') {
        await setContextVisibility(api, conversationKeys, false);
        return { text: 'MEMOS context monitoring is now off for this conversation.' };
      }

      return {
        text: 'Usage: /memos context on|off',
        isError: true,
      };
    },
  });

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
  api.registerTool((ctx) => ({
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
    execute: async (_toolCallId, params) =>
      memosRecallTool(params as { query: string; limit?: number }, buildToolRuntimeContext(ctx), pluginConfig, client),
  }));

  // memos_cross_dept tool
  api.registerTool((ctx) => ({
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
    execute: async (_toolCallId, params) =>
      memosCrossDeptTool(
        params as { department: string; query: string; limit?: number },
        buildToolRuntimeContext(ctx),
        pluginConfig,
        client
      ),
  }));

  // memos_drill_down tool
  api.registerTool((ctx) => ({
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
    execute: async (_toolCallId, params) =>
      memosDrillDownTool(
        params as { summary_id: string; limit?: number },
        buildToolRuntimeContext(ctx),
        pluginConfig,
        client
      ),
  }));

  // memory_search tool (compat alias)
  api.registerTool((ctx) => ({
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
    execute: async (_toolCallId, params) =>
      memorySearchTool(params as { query: string; limit?: number }, buildToolRuntimeContext(ctx), pluginConfig, client),
  }));

  // memory_store tool
  api.registerTool((ctx) => ({
    name: 'memory_store',
    description: 'Store a private memory explicitly for the current agent',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Memory text to store' },
      },
      required: ['text'],
    },
    execute: async (_toolCallId, params) =>
      memoryStoreTool(
        params as { text: string },
        buildToolRuntimeContext(ctx),
        pluginConfig,
        client
      ),
  }));

  // memos_announce tool
  api.registerTool((ctx) => ({
    name: 'memos_announce',
    description: 'Publish a deliberate department-wide announcement to the caller department (management/confidential only)',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Announcement text to publish' },
      },
      required: ['text'],
    },
    execute: async (_toolCallId, params) =>
      memosAnnounceTool(
        params as { text: string },
        buildToolRuntimeContext(ctx),
        pluginConfig,
        client
      ),
  }));

  // memos_broadcast tool
  api.registerTool((ctx) => ({
    name: 'memos_broadcast',
    description: 'Publish a deliberate company-wide broadcast to shared company memory (management/confidential only)',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Broadcast text to publish' },
      },
      required: ['text'],
    },
    execute: async (_toolCallId, params) =>
      memosBroadcastTool(
        params as { text: string },
        buildToolRuntimeContext(ctx),
        pluginConfig,
        client
      ),
  }));

  // Register metrics HTTP endpoint for Prometheus scraping
  api.registerHttpRoute({
    path: '/plugins/memos/metrics',
    auth: 'plugin',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'GET') {
        res.statusCode = 405;
        res.end('Method Not Allowed');
        return true;
      }
      try {
        const metrics = await getMetrics();
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.end(metrics);
        return true;
      } catch (error) {
        logger.error('Failed to get metrics', error);
        res.statusCode = 500;
        res.end('Internal Server Error');
        return true;
      }
    },
  });

  logger.info('Metrics endpoint registered at /plugins/memos/metrics');
  logger.info(
    `Graphiti backend configured: ${pluginConfig.graphiti_backend} ` +
      `(rest_fallback=${pluginConfig.graphiti_enable_rest_fallback ? 'on' : 'off'})`,
  );

  // Keep the interval reachable to prevent it from being optimized away.
  void healthCheckInterval;
  void openAiReportingInterval;
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
