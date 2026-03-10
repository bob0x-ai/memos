import { GraphitiClient } from '../graphiti-client';
import { MemosConfig } from '../config';
import { resolveDepartment } from '../utils/department';
import { canAccess } from '../utils/access';
import { getAgentConfig, getDepartmentConfig } from '../utils/config';
import { logger } from '../utils/logger';

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
    const department = agentConfig?.department || resolveDepartment(ctx.agentId, config);
    if (!department) {
      logger.warn(`memos_recall denied: no department for agent ${ctx.agentId}`);
      return {
        success: false,
        facts: [],
        error: `No department found for agent ${ctx.agentId}`,
      };
    }

    const limit = params.limit || 10;

    // Search facts
    const facts = await client.searchFacts(department, params.query, limit);

    return {
      success: true,
      facts,
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

    if (!canAccess(requesterConfig.access_level, targetDepartmentConfig.access_level)) {
      logger.warn(
        `memos_cross_dept denied: agent ${ctx.agentId} (${requesterConfig.access_level}) cannot access ` +
        `${params.department} (${targetDepartmentConfig.access_level})`
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
];
