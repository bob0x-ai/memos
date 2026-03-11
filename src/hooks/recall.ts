import { GraphitiClient } from '../graphiti-client';
import { MemosConfig } from '../config';
import { getAgentConfig, getAllDepartments, loadConfig } from '../utils/config';
import { getAccessFilter } from '../ontology';
import { recallDuration, recallErrors, recallOperations, recallResults, summaryModeSelections } from '../metrics/prometheus';
import { logger } from '../utils/logger';
import { formatSummaryAsContext, getOrGenerateSummary } from '../utils/summarization';

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
  if (results.length === 0) {
    return [];
  }

  const k = 60; // RRF constant

  const withMeta = results.map((result, index) => ({
    result,
    index,
    key: result.uuid || `idx:${index}`,
  }));

  const byRetrieval = [...withMeta];
  const byImportance = [...withMeta].sort((a, b) => {
    const importanceA = typeof a.result.importance === 'number' ? a.result.importance : 3;
    const importanceB = typeof b.result.importance === 'number' ? b.result.importance : 3;
    if (importanceA !== importanceB) {
      return importanceB - importanceA;
    }
    return a.index - b.index;
  });

  const byRecency = [...withMeta].sort((a, b) => {
    const recencyA = Date.parse(a.result.valid_at || a.result.created_at || '');
    const recencyB = Date.parse(b.result.valid_at || b.result.created_at || '');
    const safeA = Number.isNaN(recencyA) ? 0 : recencyA;
    const safeB = Number.isNaN(recencyB) ? 0 : recencyB;
    if (safeA !== safeB) {
      return safeB - safeA;
    }
    return a.index - b.index;
  });

  const rankings = [byRetrieval, byImportance, byRecency];
  const scoreByKey = new Map<string, number>();

  for (const ranking of rankings) {
    ranking.forEach((entry, rankIndex) => {
      const rank = rankIndex + 1;
      const prev = scoreByKey.get(entry.key) || 0;
      scoreByKey.set(entry.key, prev + 1 / (k + rank));
    });
  }

  const scored = withMeta.map(entry => ({
    result: entry.result,
    score: scoreByKey.get(entry.key) || 0,
    index: entry.index,
  }));

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.index - b.index;
  });

  return scored.slice(0, limit).map(s => s.result);
}

function parseRankedIds(content: string): string[] {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed.map(String);
    }
    if (parsed && Array.isArray(parsed.ranked_ids)) {
      return parsed.ranked_ids.map(String);
    }
  } catch {
    // Fall through to regex extraction below.
  }

  const objectMatch = content.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);
      if (parsed && Array.isArray(parsed.ranked_ids)) {
        return parsed.ranked_ids.map(String);
      }
    } catch {
      // Ignore and continue.
    }
  }

  return [];
}

export async function crossEncoderRerank(
  results: any[],
  query: string,
  limit: number,
  model: string
): Promise<any[]> {
  if (results.length === 0) {
    return [];
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.warn('OPENAI_API_KEY not set, falling back to local RRF reranking');
    return rrfRerank(results, limit);
  }

  const candidates = results.map((result, index) => ({
    id: result.uuid || `idx:${index}`,
    fact: String(result.fact || '').slice(0, 400),
    content_type: result.content_type || 'fact',
    importance: typeof result.importance === 'number' ? result.importance : 3,
    valid_at: result.valid_at || result.created_at || null,
    original: result,
    index,
  }));

  const payload = {
    query,
    candidates: candidates.map(c => ({
      id: c.id,
      fact: c.fact,
      content_type: c.content_type,
      importance: c.importance,
      valid_at: c.valid_at,
    })),
    max_results: limit,
  };

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 300,
        messages: [
          {
            role: 'system',
            content: 'You are a relevance reranker. Return ONLY JSON: {"ranked_ids":[...]} ordered best to worst.',
          },
          {
            role: 'user',
            content: JSON.stringify(payload),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Reranker API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content || '';
    const rankedIds = parseRankedIds(content);
    if (rankedIds.length === 0) {
      throw new Error('Reranker did not return ranked_ids');
    }

    const byId = new Map(candidates.map(c => [c.id, c]));
    const ordered: any[] = [];
    const seen = new Set<string>();

    for (const id of rankedIds) {
      const candidate = byId.get(id);
      if (candidate && !seen.has(id)) {
        seen.add(id);
        ordered.push(candidate.original);
      }
    }

    for (const candidate of candidates) {
      if (!seen.has(candidate.id)) {
        ordered.push(candidate.original);
      }
    }

    return ordered.slice(0, limit);
  } catch (error) {
    logger.warn('Cross-encoder reranker failed, falling back to local RRF', error);
    return rrfRerank(results, limit);
  }
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

  const department = agentConfig.department;
  const departmentLabel = department || 'all';
  recallOperations.labels(departmentLabel, ctx.agentId).inc();
  const recallLimit = Math.min(config.recall_limit, agentConfig.recall.max_results);

  const allDepartments = getAllDepartments();
  const departmentsToQuery =
    agentConfig.access_level === 'confidential' ||
    agentConfig.recall.department_scope === 'all' ||
    !department
      ? allDepartments
      : [department];

  if (departmentsToQuery.length === 0) {
    logger.warn(`No departments available for recall (agent: ${ctx.agentId})`);
    return {};
  }

  // Build access filter (Phase 7: permission scoping)
  const allowedAccessLevels = getAccessFilter(agentConfig.access_level);
  const allowedContentTypes = agentConfig.recall.content_types;
  const summaryOnlyMode =
    allowedContentTypes.length === 1 && allowedContentTypes[0] === 'summary';
  const retrievalContentTypes = summaryOnlyMode
    ? runtimeConfig.ontology.content_types.filter(type => type !== 'summary')
    : allowedContentTypes;
  const minImportance = agentConfig.recall.min_importance;

  logger.debug(`Recalling for agent ${ctx.agentId} (access: ${agentConfig.access_level})`);
  logger.debug(`Allowed access levels: ${allowedAccessLevels.join(', ')}`);
  logger.debug(`Recall mode: ${summaryOnlyMode ? 'summary-only' : 'detailed-facts'}`);
  logger.debug(`Allowed content types: ${allowedContentTypes.join(', ')}`);
  logger.debug(`Retrieval content types: ${retrievalContentTypes.join(', ')}`);
  logger.debug(`Minimum importance: ${minImportance}`);

  // Build query from recent messages
  const query = buildQueryFromMessages(ctx.messages);
  if (!query) {
    logger.debug(`No user query extracted for agent ${ctx.agentId}, skipping recall`);
    return {};
  }

  try {
    // Convert messages to Graphiti format
    const graphitiMessages = ctx.messages.slice(-3).map(m => ({
      content: m.content,
      role_type: m.role as 'user' | 'assistant',
    }));

    const memoryByDepartment = await Promise.allSettled(
      departmentsToQuery.map(async dept => ({
        department: dept,
        memory: await client.getMemory(
          dept,
          graphitiMessages,
          recallLimit * 2,
          {
            access_levels: allowedAccessLevels,
            content_types: retrievalContentTypes,
            min_importance: minImportance
          }
        )
      }))
    );

    const allFacts: any[] = [];
    for (const result of memoryByDepartment) {
      if (result.status === 'fulfilled') {
        const { department: sourceDepartment, memory } = result.value;
        allFacts.push(...memory.facts.map((fact: any) => ({ ...fact, _department: sourceDepartment })));
      } else {
        logger.warn('Recall failed for one department; continuing with remaining departments', result.reason);
      }
    }

    // Filter results by access level and content type (Phase 7)
    const filteredFacts = allFacts.filter((fact: any) => {
      const accessLevel = fact.access_level || 'public';
      const contentType = fact.content_type || 'fact';
      const importance = typeof fact.importance === 'number' ? fact.importance : 3;

      return (
        allowedAccessLevels.includes(accessLevel) &&
        retrievalContentTypes.includes(contentType) &&
        importance >= minImportance
      );
    });

    // Deduplicate facts that may appear across multiple queried departments.
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

    logger.info(
      `Recall queried ${departmentsToQuery.length} department(s), retrieved ${allFacts.length} facts, ` +
      `filtered to ${dedupedFacts.length} for ${ctx.agentId}`
    );

    if (summaryOnlyMode) {
      const capabilities = await client.detectCapabilities();
      if (capabilities.mode === 'native_communities') {
        logger.info('Graphiti community endpoints detected; using plugin-side summary fallback until native integration is added');
      } else {
        logger.info('Using plugin-side summary fallback chain (no native community endpoints detected)');
      }
      summaryModeSelections.labels(capabilities.mode).inc();

      const summaryCandidates = rrfRerank(dedupedFacts, Math.max(recallLimit * 2, 6));
      if (summaryCandidates.length === 0) {
        logger.debug(`No facts available for summary generation for ${ctx.agentId}`);
        recallResults.labels(departmentLabel).observe(0);
        recallDuration.labels(departmentLabel).observe((Date.now() - startTime) / 1000);
        return {};
      }
      const summary = await getOrGenerateSummary({
        query,
        departments: departmentsToQuery,
        facts: summaryCandidates,
        cacheTtlHours: runtimeConfig.summarization.cache_ttl_hours,
        model: runtimeConfig.llm.model,
        agentId: ctx.agentId,
        mode: capabilities.mode,
      });

      recallResults.labels(departmentLabel).observe(summaryCandidates.length);
      recallDuration.labels(departmentLabel).observe((Date.now() - startTime) / 1000);
      return {
        prependSystemContext: formatSummaryAsContext(summary.summaryId, summary.summary, summary.sourceFactIds),
      };
    }

    // Rerank results (Phase 7)
    const rerankedFacts = agentConfig.recall.reranker === 'cross_encoder'
      ? await crossEncoderRerank(
        dedupedFacts,
        query,
        recallLimit,
        runtimeConfig.llm.model
      )
      : rrfRerank(dedupedFacts, recallLimit);

    // Format results into context
    const context = formatFactsAsContext(rerankedFacts);

    if (context) {
      recallResults.labels(departmentLabel).observe(rerankedFacts.length);
      recallDuration.labels(departmentLabel).observe((Date.now() - startTime) / 1000);
      return { prependSystemContext: context };
    }

    recallResults.labels(departmentLabel).observe(0);
    recallDuration.labels(departmentLabel).observe((Date.now() - startTime) / 1000);
    return {};
  } catch (error) {
    recallErrors.labels(departmentLabel, 'recall_failed').inc();
    recallDuration.labels(departmentLabel).observe((Date.now() - startTime) / 1000);
    logger.error('Failed to recall from memory', error);
    // Return empty context on error - don't break the agent run
    return {};
  }
}
