import { GraphitiClient } from '../graphiti-client';
import { MemosConfig } from '../config';
import { resolveDepartment } from '../utils/department';
import { getAgentConfig } from '../utils/config';
import { getAccessFilter } from '../ontology';

/**
 * Format search results into context for the agent
 * @param facts Array of fact results
 * @returns Formatted context string
 */
export function formatFactsAsContext(
  facts: Array<{
    uuid: string;
    fact: string;
    valid_at?: string;
    invalid_at?: string;
    content_type?: string;
    importance?: number;
  }>
): string {
  if (facts.length === 0) {
    return '';
  }

  let context = '## Relevant Context from Memory\n\n';

  // Group by content type
  const grouped = facts.reduce((acc, fact) => {
    const type = fact.content_type || 'fact';
    if (!acc[type]) acc[type] = [];
    acc[type].push(fact);
    return acc;
  }, {} as Record<string, typeof facts>);

  // Add facts grouped by type with importance indicators
  for (const [type, typeFacts] of Object.entries(grouped)) {
    context += `**${type.charAt(0).toUpperCase() + type.slice(1)}s:**\n`;
    for (const fact of typeFacts) {
      const importance = '⭐'.repeat(fact.importance || 3);
      context += `- ${importance} ${fact.fact}`;
      if (fact.valid_at) {
        context += ` (valid from ${new Date(fact.valid_at).toLocaleDateString()})`;
      }
      if (fact.invalid_at) {
        context += ` (invalid since ${new Date(fact.invalid_at).toLocaleDateString()})`;
      }
      context += '\n';
    }
    context += '\n';
  }

  return context;
}

/**
 * Build a search query from recent messages
 * @param messages Array of messages
 * @returns Query string
 */
export function buildQueryFromMessages(
  messages: Array<{ role: string; content: string }>
): string {
  // Take the last 3 messages for context
  const recentMessages = messages.slice(-3);
  
  // Extract key terms from user messages
  const userMessages = recentMessages
    .filter(m => m.role === 'user')
    .map(m => m.content);
  
  if (userMessages.length === 0) {
    return '';
  }

  // Build a simple query from the user's most recent message
  return userMessages[userMessages.length - 1];
}

/**
 * Rerank results using RRF (Reciprocal Rank Fusion)
 * @param results Array of results to rerank
 * @param limit Maximum number of results to return
 * @returns Reranked results
 */
export function rrfRerank(
  results: any[],
  limit: number
): any[] {
  const k = 60; // RRF constant
  
  // Score each result using RRF formula
  const scored = results.map((result, index) => {
    const rank = index + 1;
    const score = 1 / (k + rank);
    return { result, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Return top results
  return scored.slice(0, limit).map(s => s.result);
}

/**
 * Hook called at before_prompt_build to recall relevant facts
 * @param event The hook event
 * @param ctx The plugin context
 * @param config MEMOS configuration
 * @param client Graphiti client
 * @returns Object with context to inject
 */
export async function recallHook(
  event: unknown,
  ctx: {
    agentId: string;
    messages: Array<{ role: string; content: string }>;
  },
  config: MemosConfig,
  client: GraphitiClient
): Promise<{ prependSystemContext?: string }> {
  // Check if auto-recall is enabled
  if (!config.auto_recall) {
    return {};
  }

  // Resolve department from agent_id
  const department = resolveDepartment(ctx.agentId, config);
  if (!department) {
    console.warn(`No department found for agent ${ctx.agentId}`);
    return {};
  }

  // Get agent configuration (Phase 7: access control)
  const agentConfig = getAgentConfig(ctx.agentId);
  if (!agentConfig) {
    console.warn(`No configuration found for agent ${ctx.agentId}`);
    return {};
  }

  // Build access filter (Phase 7: permission scoping)
  const allowedAccessLevels = getAccessFilter(agentConfig.access_level);
  const allowedContentTypes = agentConfig.recall.content_types;
  const minImportance = agentConfig.recall.min_importance;

  console.debug(`Recalling for agent ${ctx.agentId} (access: ${agentConfig.access_level})`);
  console.debug(`  Allowed access levels: ${allowedAccessLevels.join(', ')}`);
  console.debug(`  Allowed content types: ${allowedContentTypes.join(', ')}`);
  console.debug(`  Min importance: ${minImportance}`);

  // Build query from recent messages
  const query = buildQueryFromMessages(ctx.messages);
  if (!query) {
    return {};
  }

  try {
    // Convert messages to Graphiti format
    const graphitiMessages = ctx.messages.slice(-3).map(m => ({
      content: m.content,
      role_type: m.role as 'user' | 'assistant',
    }));

    // Get memory from Graphiti with filters (Phase 7)
    const memory = await client.getMemory(
      department,
      graphitiMessages,
      config.recall_limit * 2, // Get extra for filtering
      {
        access_levels: allowedAccessLevels,
        content_types: allowedContentTypes,
        min_importance: minImportance
      }
    );

    // Filter results by access level and content type (Phase 7)
    const filteredFacts = memory.facts.filter((fact: any) => {
      return (
        allowedAccessLevels.includes(fact.access_level) &&
        allowedContentTypes.includes(fact.content_type) &&
        (fact.importance || 3) >= minImportance
      );
    });

    console.debug(`Retrieved ${memory.facts.length} facts, filtered to ${filteredFacts.length}`);

    // Rerank results (Phase 7)
    const rerankedFacts = rrfRerank(
      filteredFacts,
      config.recall_limit
    );

    // Format results into context
    const context = formatFactsAsContext(rerankedFacts);

    if (context) {
      return { prependSystemContext: context };
    }

    return {};
  } catch (error) {
    console.error('Failed to recall from memory:', error);
    // Return empty context on error - don't break the agent run
    return {};
  }
}
