import { GraphitiClient, retryWithBackoff } from '../graphiti-client';
import { MemosConfig } from '../config';
import { getLastExchange, isWorthRemembering, prepareExchangeForCapture } from '../utils/filter';
import { getAgentConfig, getCaptureGroupId } from '../utils/config';
import { captureDuration, captureErrors, episodesCaptured, episodesFiltered } from '../metrics/prometheus';
import { logger } from '../utils/logger';

/**
 * Hook called at agent_end to capture episodes
 * @param event The hook event
 * @param ctx The plugin context
 * @param config MEMOS configuration
 * @param client Graphiti client
 */
export async function captureHook(
  event: unknown,
  ctx: {
    agentId: string;
    messages: Array<{ role: string; content: string }>;
    userId?: string;
    sessionId?: string;
    channel?: string;
  },
  config: MemosConfig,
  client: GraphitiClient
): Promise<void> {
  const startTime = Date.now();
  // Check if auto-capture is enabled
  if (!config.auto_capture) {
    logger.debug(`Auto-capture disabled for agent ${ctx.agentId}`);
    return;
  }

  const agentConfig = getAgentConfig(ctx.agentId);
  if (!agentConfig) {
    logger.warn(`No configuration found for agent ${ctx.agentId}`);
    return;
  }

  if (!agentConfig.capture.enabled) {
    logger.info(`Capture disabled by policy for agent ${ctx.agentId} (role: ${agentConfig.role})`);
    episodesFiltered.labels(agentConfig.department || 'unknown').inc();
    return;
  }

  const captureGroupId = getCaptureGroupId(ctx.agentId, agentConfig);
  if (!captureGroupId) {
    logger.info(`No capture group resolved for agent ${ctx.agentId}; skipping capture`);
    episodesFiltered.labels('unknown').inc();
    return;
  }

  // Get the last user-assistant exchange
  const { lastUser, lastAssistant } = getLastExchange(ctx.messages);
  
  if (!lastUser || !lastAssistant) {
    logger.warn('Could not find complete user-assistant exchange');
    episodesFiltered.labels(captureGroupId).inc();
    return;
  }

  const preparedExchange = prepareExchangeForCapture(lastUser, lastAssistant);
  if (preparedExchange.skip) {
    logger.info(
      `Exchange filtered before capture for agent ${ctx.agentId} (${preparedExchange.reason || 'unknown_reason'})`
    );
    episodesFiltered.labels(captureGroupId).inc();
    return;
  }

  const sanitizedUser = preparedExchange.userMsg;
  const sanitizedAssistant = preparedExchange.assistantMsg;

  // Check if exchange is worth remembering
  if (!isWorthRemembering(sanitizedUser, sanitizedAssistant)) {
    logger.info(`Exchange filtered as trivial, not capturing for agent ${ctx.agentId}`);
    episodesFiltered.labels(captureGroupId).inc();
    return;
  }

  const timestamp = new Date().toISOString();
  const messages = [
    {
      content: sanitizedUser,
      role_type: 'user' as const,
      role: ctx.userId || 'user',
      timestamp,
    },
    {
      content: sanitizedAssistant,
      role_type: 'assistant' as const,
      role: ctx.agentId,
      timestamp,
    }
  ];

  // Build metadata for Graphiti (Phase 7: enriched metadata)
  const metadata = {
    source_description: 'openclaw:auto_capture',
  };

  try {
    // Send to Graphiti with retry logic and metadata
    await retryWithBackoff(
      () => client.addMessages(captureGroupId, messages, metadata),
      config.rate_limit_retries
    );

    episodesCaptured.labels(captureGroupId, ctx.agentId).inc();
    captureDuration.labels(captureGroupId).observe((Date.now() - startTime) / 1000);
    logger.info(`Captured episode for agent ${ctx.agentId} in group ${captureGroupId}`);
  } catch (error) {
    captureErrors.labels(captureGroupId, 'store_failed').inc();
    captureDuration.labels(captureGroupId).observe((Date.now() - startTime) / 1000);
    logger.error('Failed to capture episode', error);
    // Log but don't throw - we don't want to break the agent run
  }
}
