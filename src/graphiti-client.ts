import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from './utils/logger';

export interface EpisodeMetadata {
  agent_id: string;
  user_id: string;
  session_id: string;
  channel: string;
  timestamp: number;
}

export interface AddMessagesRequest {
  group_id: string;
  messages: Array<{
    content: string;
    role_type: 'user' | 'assistant' | 'system';
    role?: string;
    timestamp?: string;
    source_description?: string;
    uuid?: string;
  }>;
  metadata?: Record<string, unknown>;
}

export interface SearchResult {
  uuid: string;
  fact: string;
  source_node_uuid: string;
  target_node_uuid: string;
  valid_at?: string;
  invalid_at?: string;
  access_level?: string;
  content_type?: string;
  importance?: number;
}

export interface NodeResult {
  uuid: string;
  name: string;
  summary: string;
  labels: string[];
  created_at: string;
  attributes?: Record<string, unknown>;
}

export interface GraphitiClientConfig {
  baseUrl: string;
  timeout?: number;
}

export interface MemoryFilters {
  access_levels?: string[];
  content_types?: string[];
  min_importance?: number;
}

export interface GraphitiCapabilities {
  hasCommunityEndpoints: boolean;
  supportsUpdateCommunitiesFlag: boolean;
  mode: 'native_communities' | 'fallback_summaries';
}

export class GraphitiClient {
  private client: AxiosInstance;
  private capabilitiesCache: GraphitiCapabilities | null = null;

  constructor(config: GraphitiClientConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout || 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Add messages to the knowledge graph
   * @param groupId The department/group ID (e.g., "ops", "devops")
   * @param messages Array of messages to add
   * @returns Success status
   */
  async addMessages(
    groupId: string,
    messages: Array<{ content: string; role_type: 'user' | 'assistant'; role?: string; timestamp?: string }>,
    metadata?: Record<string, unknown>
  ): Promise<boolean> {
    const request: AddMessagesRequest = {
      group_id: groupId,
      messages: messages.map(m => ({
        ...m,
        source_description: 'openclaw-conversation',
      })),
      metadata,
    };

    const response = await this.client.post('/messages', request);
    return response.status === 202;
  }

  /**
   * Search for facts/relationships in the graph
   * @param groupId The department/group ID
   * @param query Search query
   * @param limit Maximum number of results
   * @returns Array of search results
   */
  async searchFacts(
    groupId: string,
    query: string,
    limit: number = 10
  ): Promise<SearchResult[]> {
    const response = await this.client.post('/search', {
      query,
      group_ids: [groupId],
      max_facts: limit,
    });

    return response.data.results || [];
  }

  /**
   * Get memory for a conversation context
   * @param groupId The department/group ID
   * @param messages Current conversation messages
   * @param limit Maximum number of facts
   * @returns Memory results
   */
  async getMemory(
    groupId: string,
    messages: Array<{ content: string; role_type: 'user' | 'assistant' }>,
    limit: number = 10,
    filters?: MemoryFilters
  ): Promise<{ facts: SearchResult[]; nodes: NodeResult[] }> {
    const requestBody: Record<string, unknown> = {
      group_id: groupId,
      messages: messages.map(m => ({
        ...m,
        timestamp: new Date().toISOString(),
      })),
      max_facts: limit,
      center_node_uuid: null,
    };

    if (filters?.access_levels) {
      requestBody.access_levels = filters.access_levels;
    }
    if (filters?.content_types) {
      requestBody.content_types = filters.content_types;
    }
    if (filters?.min_importance !== undefined) {
      requestBody.min_importance = filters.min_importance;
    }

    const response = await this.client.post('/get-memory', requestBody);

    return response.data || { facts: [], nodes: [] };
  }

  /**
   * Detect Graphiti API capabilities from OpenAPI.
   * Falls back to conservative defaults when unavailable.
   */
  async detectCapabilities(forceRefresh: boolean = false): Promise<GraphitiCapabilities> {
    if (this.capabilitiesCache && !forceRefresh) {
      return this.capabilitiesCache;
    }

    try {
      const response = await this.client.get('/openapi.json');
      const openapi = response.data as {
        paths?: Record<string, unknown>;
        components?: {
          schemas?: Record<
            string,
            {
              properties?: Record<string, unknown>;
            }
          >;
        };
      };

      const pathKeys = Object.keys(openapi.paths || {});
      const hasCommunityEndpoints = pathKeys.some(path => /community|communities/i.test(path));
      const addMessagesSchema = openapi.components?.schemas?.AddMessagesRequest;
      const supportsUpdateCommunitiesFlag = Boolean(
        addMessagesSchema?.properties && 'update_communities' in addMessagesSchema.properties
      );

      this.capabilitiesCache = {
        hasCommunityEndpoints,
        supportsUpdateCommunitiesFlag,
        mode: hasCommunityEndpoints ? 'native_communities' : 'fallback_summaries',
      };

      return this.capabilitiesCache;
    } catch (error) {
      logger.warn('Could not detect Graphiti capabilities, defaulting to fallback summaries', error);
      this.capabilitiesCache = {
        hasCommunityEndpoints: false,
        supportsUpdateCommunitiesFlag: false,
        mode: 'fallback_summaries',
      };
      return this.capabilitiesCache;
    }
  }

  /**
   * Check if Graphiti server is healthy
   * @returns True if healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/healthcheck');
      return response.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Clear all data (use with caution)
   */
  async clear(): Promise<void> {
    await this.client.post('/clear');
  }
}

/**
 * Retry a Graphiti operation with exponential backoff
 * @param operation The operation to retry
 * @param retries Maximum number of retries
 * @returns Result of the operation
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  retries: number = 3
): Promise<T> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const axiosError = error as AxiosError;
      
      // Check if it's a rate limit error (429)
      if (axiosError.response?.status === 429 && attempt < retries - 1) {
        const delay = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
        logger.warn(
          `Rate limited by Graphiti, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`
        );
        await sleep(delay);
        continue;
      }

      // Check if Graphiti server is unavailable
      if (axiosError.code === 'ECONNREFUSED' || axiosError.code === 'ENOTFOUND') {
        logger.error('Graphiti server unavailable');
        throw new Error('Graphiti server unavailable');
      }

      throw error;
    }
  }

  throw new Error('Max retries exceeded');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
