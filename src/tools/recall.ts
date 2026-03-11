import { GraphitiClient } from '../graphiti-client';
import { MemosConfig } from '../config';
import { getAgentConfig, getAllDepartments, getDepartmentConfig } from '../utils/config';
import { drillDownCalls, drillDownDuration, drillDownErrors } from '../metrics/prometheus';
import { logger } from '../utils/logger';
import { getSummaryDrillDown } from '../utils/summarization';

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
  try {
    const agentConfig = getAgentConfig(ctx.agentId);
    if (!agentConfig) {
      logger.warn(`memos_recall denied: no policy for agent ${ctx.agentId}`);
      return {
        success: false,
        facts: [],
        error: `No policy found for agent ${ctx.agentId}`,
      };
    }

    const departmentsToQuery =
      agentConfig.access_level === 'confidential' ||
      agentConfig.recall.department_scope === 'all' ||
      !agentConfig.department
        ? getAllDepartments()
        : [agentConfig.department];

    if (departmentsToQuery.length === 0) {
      logger.warn(`memos_recall denied: no department for agent ${ctx.agentId}`);
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
  try {
    const requesterConfig = getAgentConfig(ctx.agentId);
    if (!requesterConfig) {
      logger.warn(`memos_cross_dept denied: no policy config for agent ${ctx.agentId}`);
      return {
        success: false,
        facts: [],
        error: `No configuration found for agent ${ctx.agentId}`,
      };
    }

    const targetDepartmentConfig = getDepartmentConfig(params.department);
    if (!targetDepartmentConfig) {
      logger.warn(`memos_cross_dept denied: target department ${params.department} not found`);
      return {
        success: false,
        facts: [],
        error: `Department "${params.department}" not found`,
      };
    }

    const canReadCrossDepartment =
      requesterConfig.access_level === 'confidential' ||
      requesterConfig.department === params.department;

    if (!canReadCrossDepartment) {
      logger.warn(
        `memos_cross_dept denied: agent ${ctx.agentId} (${requesterConfig.access_level}) cannot access ` +
        `department ${params.department}`
      );
      return {
        success: false,
        facts: [],
        error: `Agent ${ctx.agentId} is not allowed to access department "${params.department}"`,
      };
    }

    const limit = params.limit || 10;

    // Search facts in target department
    const facts = await client.searchFacts(params.department, params.query, limit);

    return {
      success: true,
      facts,
    };
  } catch (error) {
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
    if (!requesterConfig) {
      logger.warn(`memos_drill_down denied: no policy config for agent ${ctx.agentId}`);
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
];
