import { GraphitiClient, NodeResult } from '../graphiti-client';
import { MemosConfig } from '../config';
import { getAgentConfig, getGroupsForRecall, loadConfig } from '../utils/config';
import {
  recallDuration,
  recallErrors,
  recallOperations,
  recallResults,
  summaryModeSelections,
  summaryRetrievalOutcomes,
  summaryRetrievalSources,
} from '../metrics/prometheus';
import { logger } from '../utils/logger';
import {
  formatSummaryAsContext,
  getOrGenerateSummary,
  prepareSummaryCandidates,
} from '../utils/summarization';
import { containsDurableSignal, isLowSignalFact, prepareMessagesForRecall } from '../utils/filter';

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
    importance?: number;
  }>
): string {
  if (facts.length === 0) {
    return '';
  }

  let context = '## Relevant Context from Memory\n\n';

  for (const fact of facts) {
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

  return context;
}

function suppressLowSignalFacts<T extends { fact?: string }>(facts: T[]): T[] {
  return facts.filter((fact) => {
    const text = typeof fact.fact === 'string' ? fact.fact.trim() : '';
    if (!text) {
      return false;
    }
    return !isLowSignalFact(text);
  });
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

function normalizeQuerySnippet(content: string, maxLength: number = 160): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function uniqueSnippets(snippets: string[]): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  for (const snippet of snippets) {
    const normalized = normalizeQuerySnippet(snippet);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(normalized);
  }

  return results;
}

export function buildManagementRecallQueries(
  messages: Array<{ role: string; content: string }>,
): { primaryQuery: string; fallbackQuery: string } {
  const recentMessages = messages.slice(-4);
  const lastUserMessage = [...recentMessages].reverse().find((message) => message.role === 'user');
  const baseUserQuery = normalizeQuerySnippet(lastUserMessage?.content || '');
  if (!baseUserQuery) {
    return { primaryQuery: '', fallbackQuery: '' };
  }

  const durableAssistantContext = uniqueSnippets(
    recentMessages
      .filter((message) => message.role === 'assistant')
      .map((message) => message.content)
      .filter((content) => containsDurableSignal(content))
      .slice(-2),
  );

  const primaryParts = uniqueSnippets([baseUserQuery, ...durableAssistantContext]);
  const primaryQuery = primaryParts.join('\n');

  const broaderContext = uniqueSnippets(
    recentMessages
      .map((message) => message.content)
      .filter((content) => content && content.trim().length > 0)
      .slice(-4),
  );
  const fallbackParts = uniqueSnippets([baseUserQuery, ...broaderContext]);
  const fallbackQuery = fallbackParts.join('\n');

  return {
    primaryQuery,
    fallbackQuery,
  };
}

async function searchFactsAcrossDepartments(
  client: GraphitiClient,
  departmentsToQuery: string[],
  query: string,
  limit: number,
): Promise<any[]> {
  const factsByDepartment = await Promise.allSettled(
    departmentsToQuery.map(async (dept) => ({
      department: dept,
      facts: await client.searchFacts(dept, query, limit),
    })),
  );

  const allFacts: any[] = [];
  for (const result of factsByDepartment) {
    if (result.status === 'fulfilled') {
      const { department: sourceDepartment, facts } = result.value;
      allFacts.push(...facts.map((fact: any) => ({ ...fact, _department: sourceDepartment })));
    } else {
      logger.warn(
        'Recall failed for one department; continuing with remaining departments',
        result.reason,
      );
    }
  }

  return allFacts;
}

type NodeSearchResultWithDepartment = NodeResult & { _department: string };

async function searchNodesAcrossDepartments(
  client: GraphitiClient,
  departmentsToQuery: string[],
  query: string,
  limit: number,
  options?: {
    entityTypes?: string[];
  },
): Promise<NodeSearchResultWithDepartment[]> {
  const nodesByDepartment = await Promise.allSettled(
    departmentsToQuery.map(async (dept) => ({
      department: dept,
      nodes: await client.searchNodes(dept, query, limit, options),
    })),
  );

  const allNodes: NodeSearchResultWithDepartment[] = [];
  for (const result of nodesByDepartment) {
    if (result.status === 'fulfilled') {
      const { department: sourceDepartment, nodes } = result.value;
      allNodes.push(
        ...nodes.map((node) => ({
          ...node,
          _department: sourceDepartment,
        })),
      );
    } else {
      logger.warn(
        'Recall node search failed for one department; continuing with remaining departments',
        result.reason,
      );
    }
  }

  return allNodes;
}

function selectCenterNodes(
  nodes: NodeSearchResultWithDepartment[],
  maxCenters: number = 3,
): NodeSearchResultWithDepartment[] {
  const selected: NodeSearchResultWithDepartment[] = [];
  const seen = new Set<string>();

  for (const node of nodes) {
    if (!node.uuid) {
      continue;
    }
    const text = node.summary?.trim() || node.name?.trim() || '';
    if (!text || isLowSignalFact(text)) {
      continue;
    }
    if (seen.has(node.uuid)) {
      continue;
    }
    seen.add(node.uuid);
    selected.push(node);
    if (selected.length >= maxCenters) {
      break;
    }
  }

  return selected;
}

async function searchCenteredFactsFromNodes(
  client: GraphitiClient,
  nodes: NodeSearchResultWithDepartment[],
  query: string,
  limit: number,
): Promise<any[]> {
  const centerNodes = selectCenterNodes(nodes);
  if (centerNodes.length === 0) {
    return [];
  }

  const centeredSearches = await Promise.allSettled(
    centerNodes.map(async (node) => {
      const department = node.group_id || node._department;
      return {
        centerNodeUuid: node.uuid,
        department,
        facts: await client.searchFacts(
          department,
          query,
          limit,
          { centerNodeUuid: node.uuid },
        ),
      };
    }),
  );

  const allFacts: any[] = [];
  for (const result of centeredSearches) {
    if (result.status === 'fulfilled') {
      const { centerNodeUuid, department, facts } = result.value;
      allFacts.push(
        ...facts.map((fact: any) => ({
          ...fact,
          _department: department,
          _center_node_uuid: centerNodeUuid,
        })),
      );
    } else {
      logger.warn('Recall centered fact search failed for one node; continuing', result.reason);
    }
  }

  return allFacts;
}

function filterAndCleanFacts(params: {
  allFacts: any[];
  minImportance: number;
}): any[] {
  const filteredFacts = params.allFacts.filter((fact: any) => {
    const importance = typeof fact.importance === 'number' ? fact.importance : 3;
    return importance >= params.minImportance;
  });

  const dedupedFacts: any[] = [];
  const seen = new Set<string>();
  for (const fact of filteredFacts) {
    const key = fact.uuid || `${fact._department || 'unknown'}:${fact.fact}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    dedupedFacts.push(fact);
  }

  return suppressLowSignalFacts(dedupedFacts);
}

function nodesToSummaryCandidates(
  nodes: Array<NodeResult & { _department?: string }>,
): Array<{
  uuid: string;
  fact: string;
  importance: number;
  created_at: string;
  _department?: string;
}> {
  const deduped: Array<{
    uuid: string;
    fact: string;
    importance: number;
    created_at: string;
    _department?: string;
  }> = [];
  const seen = new Set<string>();

  for (const node of nodes) {
    const name = node.name.trim();
    const summary = node.summary.trim();
    const fact = summary && name ? `${name}: ${summary}` : summary || name;
    if (!fact) {
      continue;
    }

    const key = node.uuid || `${node._department || 'unknown'}:${fact}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    deduped.push({
      uuid: node.uuid,
      fact,
      importance: 3,
      created_at: node.created_at,
      _department: node._department,
    });
  }

  return suppressLowSignalFacts(deduped);
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
): Promise<{ prependSystemContext?: string; monitorAttempted?: boolean }> {
  const startTime = Date.now();
  // Check if auto-recall is enabled
  if (!config.auto_recall) {
    logger.debug(`Auto-recall disabled for agent ${ctx.agentId}`);
    return {};
  }

  // Get agent configuration (Phase 7: access control)
  const agentConfig = getAgentConfig(ctx.agentId);
  if (!agentConfig) {
    logger.warn(`No configuration found for agent ${ctx.agentId}`);
    return {};
  }
  const runtimeConfig = loadConfig();

  const departmentLabel = agentConfig.department || 'all';
  recallOperations.labels(departmentLabel, ctx.agentId).inc();
  const recallLimit = Math.min(config.recall_limit, agentConfig.recall.max_results);

  const groupsToQuery = getGroupsForRecall(ctx.agentId, agentConfig);

  if (groupsToQuery.length === 0) {
    logger.warn(`No groups available for recall (agent: ${ctx.agentId})`);
    return {};
  }

  const summaryOnlyMode = agentConfig.recall.mode === 'summary';
  const minImportance = agentConfig.recall.min_importance;

  logger.debug(`Recalling for agent ${ctx.agentId} with groups: ${groupsToQuery.join(', ')}`);
  logger.debug(`Recall mode: ${summaryOnlyMode ? 'summary-only' : 'detailed-facts'}`);
  logger.debug(`Minimum importance: ${minImportance}`);

  const recallMessages = prepareMessagesForRecall(ctx.messages, 3);
  const hasRealUserTopic = recallMessages.some((message) => message.role === 'user');

  if (!hasRealUserTopic) {
    logger.info(`No real user topic found for ${ctx.agentId}; suppressing startup auto-injection`);
    recallResults.labels(departmentLabel).observe(0);
    recallDuration.labels(departmentLabel).observe((Date.now() - startTime) / 1000);
    return { monitorAttempted: true };
  }

  // Build query from recent messages
  const workerQuery = buildQueryFromMessages(recallMessages);
  const managementQueries = summaryOnlyMode
    ? buildManagementRecallQueries(recallMessages)
    : { primaryQuery: '', fallbackQuery: '' };
  const query = summaryOnlyMode ? managementQueries.primaryQuery : workerQuery;
  if (!query) {
    logger.debug(`No user query extracted for agent ${ctx.agentId}, skipping recall`);
    recallResults.labels(departmentLabel).observe(0);
    recallDuration.labels(departmentLabel).observe((Date.now() - startTime) / 1000);
    return { monitorAttempted: true };
  }

  try {
    const strictAllFacts = await searchFactsAcrossDepartments(
      client,
      groupsToQuery,
      query,
      recallLimit * 2,
    );
    const strictFacts = filterAndCleanFacts({
      allFacts: strictAllFacts,
      minImportance,
    });

    logger.info(
      `Recall queried ${groupsToQuery.length} group(s), retrieved ${strictAllFacts.length} facts, ` +
      `filtered to ${strictFacts.length} for ${ctx.agentId}`
    );

    if (summaryOnlyMode) {
      let summaryFacts = strictFacts;
      let summaryQuery = query;
      let summarySource: 'facts' | 'nodes' = 'facts';

      if (strictFacts.length > 0) {
        summaryRetrievalOutcomes.labels(ctx.agentId, 'strict_hit').inc();
        summaryRetrievalSources.labels(ctx.agentId, 'facts', 'hit').inc();
        logger.info(
          `Management summary recall strict pass found ${strictFacts.length} candidate facts for ${ctx.agentId}`,
        );
      } else {
        summaryRetrievalOutcomes.labels(ctx.agentId, 'strict_miss').inc();
        summaryRetrievalSources.labels(ctx.agentId, 'facts', 'miss').inc();
        logger.info(`Management summary recall strict pass found no candidate facts for ${ctx.agentId}`);

        const fallbackQuery = managementQueries.fallbackQuery || query;
        const nodeResults = await searchNodesAcrossDepartments(
          client,
          groupsToQuery,
          fallbackQuery,
          Math.max(recallLimit * 2, 6),
        );
        const centeredFacts = await searchCenteredFactsFromNodes(
          client,
          nodeResults,
          fallbackQuery,
          recallLimit * 2,
        );
        const filteredCenteredFacts = filterAndCleanFacts({
          allFacts: centeredFacts,
          minImportance,
        });

        if (filteredCenteredFacts.length > 0) {
          summaryRetrievalOutcomes.labels(ctx.agentId, 'centered_fact_hit').inc();
          summaryRetrievalSources.labels(ctx.agentId, 'centered_facts', 'hit').inc();
          logger.info(
            `Management summary recall centered fact pass found ${filteredCenteredFacts.length} candidate facts for ${ctx.agentId}`,
          );
          summaryFacts = filteredCenteredFacts;
          summaryQuery = fallbackQuery;
          summarySource = 'facts';
        } else {
          summaryRetrievalOutcomes.labels(ctx.agentId, 'centered_fact_miss').inc();
          summaryRetrievalSources.labels(ctx.agentId, 'centered_facts', 'miss').inc();
          logger.info(
            `Management summary recall centered fact pass found no candidate facts for ${ctx.agentId}`,
          );

          const nodeCandidates = nodesToSummaryCandidates(nodeResults);

          if (nodeCandidates.length > 0) {
            summaryRetrievalOutcomes.labels(ctx.agentId, 'node_summary_hit').inc();
            summaryRetrievalSources.labels(ctx.agentId, 'nodes', 'hit').inc();
            logger.info(
              `Management summary recall node fallback found ${nodeCandidates.length} candidate node summaries for ${ctx.agentId}`,
            );
            summaryFacts = nodeCandidates;
            summaryQuery = fallbackQuery;
            summarySource = 'nodes';
          } else {
            summaryRetrievalOutcomes.labels(ctx.agentId, 'node_summary_miss').inc();
            summaryRetrievalSources.labels(ctx.agentId, 'nodes', 'miss').inc();
            logger.info(
              `Management summary recall node fallback found no candidate node summaries for ${ctx.agentId}`,
            );
          }
        }
      }

      const capabilities = await client.detectCapabilities();
      if (capabilities.mode === 'native_communities') {
        logger.info('Graphiti community endpoints detected; using plugin-side summary fallback until native integration is added');
      } else {
        logger.info('Using plugin-side summary fallback chain (no native community endpoints detected)');
      }
      summaryModeSelections.labels(capabilities.mode).inc();

      const summaryCandidates = prepareSummaryCandidates({
        query: summaryQuery,
        facts: summaryFacts,
        maxTopics: 3,
        perTopicLimit: Math.max(Math.min(recallLimit, 4), 2),
      });
      if (summaryCandidates.length === 0) {
        logger.debug(`No facts available for summary generation for ${ctx.agentId}`);
        recallResults.labels(departmentLabel).observe(0);
        recallDuration.labels(departmentLabel).observe((Date.now() - startTime) / 1000);
        return { monitorAttempted: true };
      }
      logger.info(
        `Management summary recall using ${summarySource} retrieval path with ${summaryCandidates.length} candidate summaries for ${ctx.agentId}`,
      );
      const summary = await getOrGenerateSummary({
        query: summaryQuery,
        departments: groupsToQuery,
        facts: summaryCandidates,
        cacheTtlHours: runtimeConfig.summarization.cache_ttl_hours,
        model: runtimeConfig.llm.model,
        systemPrompt: runtimeConfig.llm.prompts?.summarization_system,
        agentId: ctx.agentId,
        mode: capabilities.mode,
      });

      recallResults.labels(departmentLabel).observe(summaryCandidates.length);
      recallDuration.labels(departmentLabel).observe((Date.now() - startTime) / 1000);
      return {
        prependSystemContext: formatSummaryAsContext(summary.summaryId, summary.summary, summary.sourceFactIds),
        monitorAttempted: true,
      };
    }

    let factsForContext = strictFacts;
    if (factsForContext.length === 0) {
      const nodeResults = await searchNodesAcrossDepartments(
        client,
        groupsToQuery,
        query,
        Math.max(recallLimit * 2, 6),
      );
      const centeredFacts = await searchCenteredFactsFromNodes(
        client,
        nodeResults,
        query,
        recallLimit * 2,
      );
      factsForContext = filterAndCleanFacts({
        allFacts: centeredFacts,
        minImportance,
      });
      logger.info(
        `Fact-mode recall centered retry found ${factsForContext.length} facts for ${ctx.agentId}`,
      );
    }

    const context = formatFactsAsContext(factsForContext.slice(0, recallLimit));

    if (context) {
      recallResults.labels(departmentLabel).observe(Math.min(factsForContext.length, recallLimit));
      recallDuration.labels(departmentLabel).observe((Date.now() - startTime) / 1000);
      return { prependSystemContext: context, monitorAttempted: true };
    }

    recallResults.labels(departmentLabel).observe(0);
    recallDuration.labels(departmentLabel).observe((Date.now() - startTime) / 1000);
    return { monitorAttempted: true };
  } catch (error) {
    recallErrors.labels(departmentLabel, 'recall_failed').inc();
    recallDuration.labels(departmentLabel).observe((Date.now() - startTime) / 1000);
    logger.error('Failed to recall from memory', error);
    // Return empty context on error - don't break the agent run
    return {};
  }
}
