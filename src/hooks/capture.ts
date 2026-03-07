import { GraphitiClient, retryWithBackoff } from '../graphiti-client';
import { MemosConfig } from '../config';
import { resolveDepartment } from '../utils/department';
import { isWorthRemembering, getLastExchange, buildEpisodeContent } from '../utils/filter';

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
  // Check if auto-capture is enabled
  if (!config.auto_capture) {
    return;
  }

  // Resolve department from agent_id
  const department = resolveDepartment(ctx.agentId, config);
  if (!department) {
    console.warn(`No department found for agent ${ctx.agentId}`);
    return;
  }

  // Get the last user-assistant exchange
  const { lastUser, lastAssistant } = getLastExchange(ctx.messages);
  
  if (!lastUser || !lastAssistant) {
    console.warn('Could not find complete user-assistant exchange');
    return;
  }

  // Check if exchange is worth remembering
  if (!isWorthRemembering(lastUser, lastAssistant)) {
    console.log('Exchange filtered as trivial, not capturing');
    return;
  }

  // Build episode content
  const content = buildEpisodeContent(lastUser, lastAssistant);

  // Build metadata
  const timestamp = Date.now();
  const metadata = {
    agent_id: ctx.agentId,
    user_id: ctx.userId || 'unknown',
    session_id: ctx.sessionId || 'unknown',
    channel: ctx.channel || 'unknown',
    timestamp,
  };

  try {
    // Send to Graphiti with retry logic
    await retryWithBackoff(
      () => client.addEpisode(department, content, metadata),
      config.rate_limit_retries
    );

    console.log(`Successfully captured episode for agent ${ctx.agentId} in department ${department}`);
  } catch (error) {
    console.error('Failed to capture episode:', error);
    // Log but don't throw - we don't want to break the agent run
  }
}
