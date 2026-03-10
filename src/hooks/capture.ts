import { GraphitiClient, retryWithBackoff } from '../graphiti-client';
import { MemosConfig } from '../config';
import { resolveDepartment } from '../utils/department';
import { isWorthRemembering, getLastExchange } from '../utils/filter';
import { getAgentConfig, getDepartmentConfig, loadConfig } from '../utils/config';
import { classifyContent } from '../utils/classification';
import { getAccessFilter, createNodeProperties, validateContentType, validateImportance } from '../ontology';
import { ClassificationResult } from '../types';

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

  // Get agent configuration for access level
  const agentConfig = getAgentConfig(ctx.agentId);
  if (!agentConfig) {
    console.warn(`No configuration found for agent ${ctx.agentId}`);
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

  // Build content for classification
  const content = `${lastUser}\nAssistant: ${lastAssistant}`;

  // Classify content (Phase 7: content type + importance)
  console.debug('Classifying content...');
  let classification: ClassificationResult;
  try {
    classification = await classifyContent(content);
  } catch (error) {
    console.warn('Content classification failed, using defaults:', error);
    classification = { content_type: 'fact', importance: 3 };
  }

  // Validate classification results
  if (!validateContentType(classification.content_type)) {
    console.warn(`Invalid content type: ${classification.content_type}, defaulting to 'fact'`);
    classification.content_type = 'fact';
  }

  if (!validateImportance(classification.importance)) {
    console.warn(`Invalid importance: ${classification.importance}, defaulting to 3`);
    classification.importance = 3;
  }

  console.debug(`Classified as ${classification.content_type} (importance: ${classification.importance})`);

  const timestamp = new Date().toISOString();
  const messages = [
    {
      content: lastUser,
      role_type: 'user' as const,
      role: ctx.userId || 'user',
      timestamp,
    },
    {
      content: lastAssistant,
      role_type: 'assistant' as const,
      role: ctx.agentId,
      timestamp,
    }
  ];

  // Build metadata for Graphiti (Phase 7: enriched metadata)
  const metadata = {
    agent_id: ctx.agentId,
    user_id: ctx.userId,
    session_id: ctx.sessionId,
    department: department,
    access_level: agentConfig.access_level,
    content_type: classification.content_type,
    importance: classification.importance,
    created_at: timestamp,
    update_communities: true  // Enable community detection
  };

  try {
    // Send to Graphiti with retry logic and metadata
    await retryWithBackoff(
      () => client.addMessages(department, messages, metadata),
      config.rate_limit_retries
    );

    console.log(`Successfully captured episode for agent ${ctx.agentId} in department ${department} ` +
                `(${classification.content_type}, importance: ${classification.importance})`);
  } catch (error) {
    console.error('Failed to capture episode:', error);
    // Log but don't throw - we don't want to break the agent run
  }
}
