import { GraphitiClient, retryWithBackoff } from '../graphiti-client';
import { MemosConfig } from '../config';
import {
  COMPANY_DEPARTMENT_ID,
  getAgentConfig,
  getCompanyDepartmentId,
  getDepartmentConfig,
  getDepartmentsForRecall,
} from '../utils/config';
import {
  crossDeptQueries,
  drillDownCalls,
  drillDownDuration,
  drillDownErrors,
  toolCalls,
  toolErrors,
} from '../metrics/prometheus';
import { logger } from '../utils/logger';
import { getSummaryDrillDown } from '../utils/summarization';
import { classifyContent } from '../utils/classification';
import { validateContentType, validateImportance } from '../ontology';

function recordToolCall(tool: string, department: string): void {
  toolCalls.labels(tool, department).inc();
}

function recordToolError(tool: string, department: string): void {
  toolErrors.labels(tool, department).inc();
}

function getAllowedAccessLevels(accessLevel: 'public' | 'restricted' | 'confidential'): string[] {
  return accessLevel === 'confidential'
    ? ['public', 'restricted', 'confidential']
    : accessLevel === 'restricted'
    ? ['public', 'restricted']
    : ['public'];
}

/**
 * Tool: memos_recall
 * Explicitly search for facts in the current agent's department memory
 * 
 * @param params Tool parameters
 * @param params.query Search query
 * @param params.limit Maximum number of results (optional, default 10)
 * @param ctx Plugin context
 * @param config MEMOS configuration
 * @param client Graphiti client
 * @returns Search results
 */
export async function memosRecallTool(
  params: { query: string; limit?: number },
  ctx: { agentId: string },
  config: MemosConfig,
  client: GraphitiClient
): Promise<{
  success: boolean;
  facts: Array<{ uuid: string; fact: string; valid_at?: string; invalid_at?: string }>;
  error?: string;
  }> {
  const fallbackDept = 'unknown';
  try {
    const agentConfig = getAgentConfig(ctx.agentId);
    const requesterDept = agentConfig?.department || fallbackDept;
    recordToolCall('memos_recall', requesterDept);
    if (!agentConfig) {
      logger.warn(`memos_recall denied: no policy for agent ${ctx.agentId}`);
      recordToolError('memos_recall', requesterDept);
      return {
        success: false,
        facts: [],
        error: `No policy found for agent ${ctx.agentId}`,
      };
    }

    const departmentsToQuery = getDepartmentsForRecall(agentConfig);

    if (departmentsToQuery.length === 0) {
      logger.warn(`memos_recall denied: no department for agent ${ctx.agentId}`);
      recordToolError('memos_recall', requesterDept);
      return {
        success: false,
        facts: [],
        error: `No department found for agent ${ctx.agentId}`,
      };
    }

    const limit = params.limit || 10;

    const results = await Promise.all(
      departmentsToQuery.map(async dept => ({
        department: dept,
        facts: await client.searchFacts(dept, params.query, limit),
      }))
    );

    const mergedFacts = results.flatMap(result =>
      result.facts.map(fact => ({ ...fact, source_department: result.department }))
    );

    const seen = new Set<string>();
    const dedupedFacts = mergedFacts.filter(fact => {
      const key = fact.uuid || `${fact.source_department}:${fact.fact}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

    return {
      success: true,
      facts: dedupedFacts.slice(0, limit),
    };
  } catch (error) {
    recordToolError('memos_recall', fallbackDept);
    logger.error('memos_recall tool failed', error);
    return {
      success: false,
      facts: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Tool: memos_cross_dept
 * Query another department's memory
 * 
 * @param params Tool parameters
 * @param params.department Target department name
 * @param params.query Search query
 * @param params.limit Maximum number of results (optional, default 10)
 * @param ctx Plugin context
 * @param config MEMOS configuration
 * @param client Graphiti client
 * @returns Search results
 */
export async function memosCrossDeptTool(
  params: { department: string; query: string; limit?: number },
  ctx: { agentId: string },
  config: MemosConfig,
  client: GraphitiClient
): Promise<{
  success: boolean;
  facts: Array<{ uuid: string; fact: string; valid_at?: string; invalid_at?: string }>;
  error?: string;
}> {
  const fallbackDept = 'unknown';
  try {
    const requesterConfig = getAgentConfig(ctx.agentId);
    const requesterDept = requesterConfig?.department || fallbackDept;
    recordToolCall('memos_cross_dept', requesterDept);
    if (!requesterConfig) {
      logger.warn(`memos_cross_dept denied: no policy config for agent ${ctx.agentId}`);
      recordToolError('memos_cross_dept', requesterDept);
      return {
        success: false,
        facts: [],
        error: `No configuration found for agent ${ctx.agentId}`,
      };
    }

    const targetDepartmentConfig = getDepartmentConfig(params.department);
    if (!targetDepartmentConfig) {
      logger.warn(`memos_cross_dept denied: target department ${params.department} not found`);
      recordToolError('memos_cross_dept', requesterDept);
      return {
        success: false,
        facts: [],
        error: `Department "${params.department}" not found`,
      };
    }

    const canReadCrossDepartment =
      requesterConfig.access_level === 'confidential' ||
      requesterConfig.department === params.department ||
      params.department === COMPANY_DEPARTMENT_ID;

    if (!canReadCrossDepartment) {
      logger.warn(
        `memos_cross_dept denied: agent ${ctx.agentId} (${requesterConfig.access_level}) cannot access ` +
        `department ${params.department}`
      );
      recordToolError('memos_cross_dept', requesterDept);
      return {
        success: false,
        facts: [],
        error: `Agent ${ctx.agentId} is not allowed to access department "${params.department}"`,
      };
    }

    const limit = params.limit || 10;

    // Search facts in target department
    const facts = await client.searchFacts(params.department, params.query, limit);
    crossDeptQueries.labels(requesterDept, params.department).inc();

    return {
      success: true,
      facts,
    };
  } catch (error) {
    recordToolError('memos_cross_dept', fallbackDept);
    logger.error('memos_cross_dept tool failed', error);
    return {
      success: false,
      facts: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Tool: memos_drill_down
 * Retrieve detailed facts underlying a generated summary
 *
 * @param params Tool parameters
 * @param params.summary_id Summary identifier
 * @param params.limit Maximum number of facts to return (optional, default 10)
 * @param ctx Plugin context
 * @param config MEMOS configuration
 * @param client Graphiti client
 * @returns Drill-down facts
 */
export async function memosDrillDownTool(
  params: { summary_id: string; limit?: number },
  ctx: { agentId: string },
  config: MemosConfig,
  client: GraphitiClient
): Promise<{
  success: boolean;
  summary_id: string;
  summary?: string;
  facts: Array<{ uuid?: string; fact: string; content_type?: string; importance?: number; department?: string }>;
  error?: string;
}> {
  const startTime = Date.now();
  const finish = (agentId: string, outcome: string): void => {
    drillDownCalls.labels(agentId, outcome).inc();
    drillDownDuration.labels(agentId, outcome).observe((Date.now() - startTime) / 1000);
  };

  try {
    const agentId = ctx.agentId || 'unknown';
    const requesterConfig = getAgentConfig(ctx.agentId);
    const requesterDept = requesterConfig?.department || 'unknown';
    recordToolCall('memos_drill_down', requesterDept);
    if (!requesterConfig) {
      logger.warn(`memos_drill_down denied: no policy config for agent ${ctx.agentId}`);
      recordToolError('memos_drill_down', requesterDept);
      drillDownErrors.labels(agentId, 'no_policy').inc();
      finish(agentId, 'denied_no_policy');
      return {
        success: false,
        summary_id: params.summary_id,
        facts: [],
        error: `No configuration found for agent ${ctx.agentId}`,
      };
    }

    if (requesterConfig.access_level !== 'confidential') {
      logger.warn(
        `memos_drill_down denied: agent ${ctx.agentId} (${requesterConfig.access_level}) lacks confidential access`
      );
      recordToolError('memos_drill_down', requesterDept);
      drillDownErrors.labels(agentId, 'access_denied').inc();
      finish(agentId, 'denied_access');
      return {
        success: false,
        summary_id: params.summary_id,
        facts: [],
        error: `Agent ${ctx.agentId} is not allowed to drill down summaries`,
      };
    }

    const limit = params.limit || 10;
    const drillDown = getSummaryDrillDown(params.summary_id, limit);
    if (drillDown.status === 'not_found') {
      recordToolError('memos_drill_down', requesterDept);
      drillDownErrors.labels(agentId, 'not_found').inc();
      finish(agentId, 'not_found');
      return {
        success: false,
        summary_id: params.summary_id,
        facts: [],
        error: `Summary "${params.summary_id}" not found in cache`,
      };
    }

    if (drillDown.status === 'expired') {
      recordToolError('memos_drill_down', requesterDept);
      drillDownErrors.labels(agentId, 'expired').inc();
      finish(agentId, 'expired');
      return {
        success: false,
        summary_id: params.summary_id,
        facts: [],
        error:
          `Summary "${params.summary_id}" is expired (expired at ` +
          `${new Date(drillDown.data.expiresAtMs).toISOString()})`,
      };
    }

    finish(agentId, 'success');
    return {
      success: true,
      summary_id: params.summary_id,
      summary: drillDown.data.summary,
      facts: drillDown.data.facts.map(fact => ({
        uuid: fact.uuid,
        fact: fact.fact,
        content_type: fact.content_type,
        importance: fact.importance,
        department: fact._department,
      })),
    };
  } catch (error) {
    const agentId = ctx.agentId || 'unknown';
    recordToolError('memos_drill_down', 'unknown');
    drillDownErrors.labels(agentId, 'internal').inc();
    finish(agentId, 'error');
    logger.error('memos_drill_down tool failed', error);
    return {
      success: false,
      summary_id: params.summary_id,
      facts: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Tool: memory_search
 * Compatibility alias for explicit memory search.
 */
export async function memorySearchTool(
  params: { query: string; limit?: number },
  ctx: { agentId: string },
  config: MemosConfig,
  client: GraphitiClient
): ReturnType<typeof memosRecallTool> {
  const result = await memosRecallTool(params, ctx, config, client);
  const department = getAgentConfig(ctx.agentId)?.department || 'unknown';
  recordToolCall('memory_search', department);
  if (!result.success) {
    recordToolError('memory_search', department);
  }
  return result;
}

/**
 * Tool: memory_store
 * Explicitly store a fact/memory from the current agent.
 */
export async function memoryStoreTool(
  params: {
    text: string;
    content_type?: string;
    importance?: number;
    access_level?: 'public' | 'restricted' | 'confidential';
  },
  ctx: { agentId: string; userId?: string; sessionId?: string },
  config: MemosConfig,
  client: GraphitiClient
): Promise<{
  success: boolean;
  stored?: {
    department: string;
    content_type: string;
    importance: number;
    access_level: string;
  };
  error?: string;
}> {
  const agentConfig = getAgentConfig(ctx.agentId);
  const requesterDept = agentConfig?.department || 'unknown';
  recordToolCall('memory_store', requesterDept);

  if (!agentConfig) {
    recordToolError('memory_store', requesterDept);
    return {
      success: false,
      error: `No policy found for agent ${ctx.agentId}`,
    };
  }

  if (!agentConfig.capture.enabled) {
    recordToolError('memory_store', requesterDept);
    return {
      success: false,
      error: `Capture is disabled for agent ${ctx.agentId}`,
    };
  }

  if (!agentConfig.department) {
    recordToolError('memory_store', requesterDept);
    return {
      success: false,
      error: `No department assigned for agent ${ctx.agentId}`,
    };
  }

  const text = (params.text || '').trim();
  if (!text) {
    recordToolError('memory_store', requesterDept);
    return {
      success: false,
      error: 'text is required',
    };
  }

  let contentType = params.content_type;
  let importance = params.importance;

  if (!contentType || importance === undefined) {
    const classified = await classifyContent(text);
    contentType = contentType || classified.content_type;
    importance = importance ?? classified.importance;
  }

  if (!validateContentType(contentType)) {
    contentType = 'fact';
  }
  if (!validateImportance(importance)) {
    importance = 3;
  }

  const requestedAccess = params.access_level || agentConfig.access_level;
  const allowedAccessLevels = getAllowedAccessLevels(agentConfig.access_level);

  if (!allowedAccessLevels.includes(requestedAccess)) {
    recordToolError('memory_store', requesterDept);
    return {
      success: false,
      error: `access_level "${requestedAccess}" is not allowed for agent ${ctx.agentId}`,
    };
  }

  const timestamp = new Date().toISOString();
  const messages = [
    {
      content: text,
      role_type: 'user' as const,
      role: ctx.userId || ctx.agentId,
      timestamp,
    },
  ];

  const metadata = {
    agent_id: ctx.agentId,
    user_id: ctx.userId,
    session_id: ctx.sessionId,
    department: agentConfig.department,
    access_level: requestedAccess,
    content_type: contentType,
    importance,
    created_at: timestamp,
    manual_store: true,
    update_communities: true,
  };

  try {
    await retryWithBackoff(
      () => client.addMessages(agentConfig.department!, messages, metadata),
      config.rate_limit_retries
    );
    return {
      success: true,
      stored: {
        department: agentConfig.department,
        content_type: contentType,
        importance,
        access_level: requestedAccess,
      },
    };
  } catch (error) {
    recordToolError('memory_store', requesterDept);
    logger.error('memory_store tool failed', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Tool: memos_announce
 * Deliberately publish company-wide information into the shared "company" memory group.
 * Management/confidential agents only.
 */
export async function memosAnnounceTool(
  params: {
    text: string;
    content_type?: string;
    importance?: number;
  },
  ctx: { agentId: string; userId?: string; sessionId?: string },
  config: MemosConfig,
  client: GraphitiClient
): Promise<{
  success: boolean;
  stored?: {
    department: string;
    source_department: string;
    content_type: string;
    importance: number;
    access_level: string;
  };
  error?: string;
}> {
  const requesterConfig = getAgentConfig(ctx.agentId);
  const requesterDept = requesterConfig?.department || 'unknown';
  recordToolCall('memos_announce', requesterDept);

  if (!requesterConfig) {
    recordToolError('memos_announce', requesterDept);
    return {
      success: false,
      error: `No policy found for agent ${ctx.agentId}`,
    };
  }

  if (requesterConfig.access_level !== 'confidential') {
    recordToolError('memos_announce', requesterDept);
    return {
      success: false,
      error: `Agent ${ctx.agentId} is not allowed to publish team announcements`,
    };
  }

  const targetDepartment = requesterConfig.department;
  if (!targetDepartment) {
    recordToolError('memos_announce', requesterDept);
    return {
      success: false,
      error: `No department assigned for agent ${ctx.agentId}`,
    };
  }

  const text = (params.text || '').trim();
  if (!text) {
    recordToolError('memos_announce', requesterDept);
    return {
      success: false,
      error: 'text is required',
    };
  }

  let contentType = params.content_type || 'decision';
  let importance = params.importance ?? 4;
  const requestedAccess = 'restricted';

  if (!validateContentType(contentType)) {
    contentType = 'decision';
  }
  if (!validateImportance(importance)) {
    importance = 4;
  }

  const timestamp = new Date().toISOString();
  const messages = [
    {
      content: text,
      role_type: 'user' as const,
      role: ctx.userId || ctx.agentId,
      timestamp,
    },
  ];

  const metadata = {
    agent_id: ctx.agentId,
    user_id: ctx.userId,
    session_id: ctx.sessionId,
    department: targetDepartment,
    source_department: requesterConfig.department,
    access_level: requestedAccess,
    content_type: contentType,
    importance,
    created_at: timestamp,
    manual_store: true,
    announcement: true,
    update_communities: true,
  };

  try {
    await retryWithBackoff(
      () => client.addMessages(targetDepartment, messages, metadata),
      config.rate_limit_retries
    );
    return {
      success: true,
      stored: {
        department: targetDepartment,
        source_department: requesterConfig.department || 'unknown',
        content_type: contentType,
        importance,
        access_level: requestedAccess,
      },
    };
  } catch (error) {
    recordToolError('memos_announce', requesterDept);
    logger.error('memos_announce tool failed', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Tool: memos_broadcast
 * Publish company-wide information into shared "company" memory group.
 * Management/confidential agents only.
 */
export async function memosBroadcastTool(
  params: {
    text: string;
    content_type?: string;
    importance?: number;
  },
  ctx: { agentId: string; userId?: string; sessionId?: string },
  config: MemosConfig,
  client: GraphitiClient
): Promise<{
  success: boolean;
  stored?: {
    department: string;
    source_department: string;
    content_type: string;
    importance: number;
    access_level: string;
  };
  error?: string;
}> {
  const department = getAgentConfig(ctx.agentId)?.department || 'unknown';
  recordToolCall('memos_broadcast', department);
  const requesterConfig = getAgentConfig(ctx.agentId);
  if (!requesterConfig) {
    recordToolError('memos_broadcast', department);
    return {
      success: false,
      error: `No policy found for agent ${ctx.agentId}`,
    };
  }

  if (requesterConfig.access_level !== 'confidential') {
    recordToolError('memos_broadcast', department);
    return {
      success: false,
      error: `Agent ${ctx.agentId} is not allowed to publish company broadcasts`,
    };
  }

  const companyDepartment = getCompanyDepartmentId();
  if (!companyDepartment) {
    recordToolError('memos_broadcast', department);
    return {
      success: false,
      error: 'Company department is not configured',
    };
  }

  const text = (params.text || '').trim();
  if (!text) {
    recordToolError('memos_broadcast', department);
    return {
      success: false,
      error: 'text is required',
    };
  }

  let contentType = params.content_type || 'decision';
  let importance = params.importance ?? 4;
  const requestedAccess = 'public';

  if (!validateContentType(contentType)) {
    contentType = 'decision';
  }
  if (!validateImportance(importance)) {
    importance = 4;
  }

  const timestamp = new Date().toISOString();
  const messages = [
    {
      content: text,
      role_type: 'user' as const,
      role: ctx.userId || ctx.agentId,
      timestamp,
    },
  ];

  const metadata = {
    agent_id: ctx.agentId,
    user_id: ctx.userId,
    session_id: ctx.sessionId,
    department: companyDepartment,
    source_department: requesterConfig.department,
    access_level: requestedAccess,
    content_type: contentType,
    importance,
    created_at: timestamp,
    manual_store: true,
    announcement: true,
    broadcast: true,
    update_communities: true,
  };

  let result: {
    success: boolean;
    stored?: {
      department: string;
      source_department: string;
      content_type: string;
      importance: number;
      access_level: string;
    };
    error?: string;
  };
  try {
    await retryWithBackoff(
      () => client.addMessages(companyDepartment, messages, metadata),
      config.rate_limit_retries
    );
    result = {
      success: true,
      stored: {
        department: companyDepartment,
        source_department: requesterConfig.department || 'unknown',
        content_type: contentType,
        importance,
        access_level: requestedAccess,
      },
    };
  } catch (error) {
    logger.error('memos_broadcast tool failed', error);
    result = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  if (!result.success) {
    recordToolError('memos_broadcast', department);
  }
  return result;
}

/**
 * Tool definitions for OpenClaw
 */
export const toolDefinitions = [
  {
    name: 'memos_recall',
    description: 'Search for facts and entities in the current agent\'s department memory',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query for facts/entities to recall',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of results to return (default: 10)',
          minimum: 1,
          maximum: 50,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'memos_cross_dept',
    description: 'Query another department\'s memory for cross-department knowledge sharing',
    parameters: {
      type: 'object',
      properties: {
        department: {
          type: 'string',
          description: 'Target department name (e.g., "ops", "devops")',
        },
        query: {
          type: 'string',
          description: 'Search query for facts/entities to recall',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of results to return (default: 10)',
          minimum: 1,
          maximum: 50,
        },
      },
      required: ['department', 'query'],
    },
  },
  {
    name: 'memos_drill_down',
    description: 'Retrieve detailed facts behind a summary ID (management/confidential only)',
    parameters: {
      type: 'object',
      properties: {
        summary_id: {
          type: 'string',
          description: 'Summary ID from executive summary context',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of underlying facts to return (default: 10)',
          minimum: 1,
          maximum: 50,
        },
      },
      required: ['summary_id'],
    },
  },
  {
    name: 'memory_search',
    description: 'Search memory explicitly (alias of memos_recall)',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query for facts/entities',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of results (default: 10)',
          minimum: 1,
          maximum: 50,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_store',
    description: 'Store a fact or memory explicitly',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Memory text to store',
        },
        content_type: {
          type: 'string',
          description: 'Optional content type override',
        },
        importance: {
          type: 'integer',
          description: 'Optional importance override (1-5)',
          minimum: 1,
          maximum: 5,
        },
        access_level: {
          type: 'string',
          description: 'Optional access level override (must be allowed by role policy)',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'memos_announce',
    description: 'Publish a deliberate team announcement to caller department (management/confidential only)',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Announcement text to publish to team memory',
        },
        content_type: {
          type: 'string',
          description: 'Optional content type (default: decision)',
        },
        importance: {
          type: 'integer',
          description: 'Optional importance override (default: 4)',
          minimum: 1,
          maximum: 5,
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'memos_broadcast',
    description: 'Publish a deliberate company-wide broadcast (management/confidential only)',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Broadcast text to publish to company memory',
        },
        content_type: {
          type: 'string',
          description: 'Optional content type (default: decision)',
        },
        importance: {
          type: 'integer',
          description: 'Optional importance override (default: 4)',
          minimum: 1,
          maximum: 5,
        },
      },
      required: ['text'],
    },
  },
];
