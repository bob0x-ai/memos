import axios, { AxiosError, AxiosInstance } from 'axios';
import { backendRequests } from './metrics/prometheus';
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
  importance?: number;
  attributes?: Record<string, unknown>;
}

export interface NodeResult {
  uuid: string;
  name: string;
  summary: string;
  labels: string[];
  created_at: string;
  group_id?: string;
  attributes?: Record<string, unknown>;
}

export interface GraphitiClientConfig {
  baseUrl?: string;
  mcpUrl?: string;
  backend?: 'mcp' | 'rest';
  enableRestFallback?: boolean;
  timeout?: number;
}

export interface MemoryFilters {
  min_importance?: number;
}

export interface GraphitiCapabilities {
  hasCommunityEndpoints: boolean;
  supportsUpdateCommunitiesFlag: boolean;
  mode: 'native_communities' | 'fallback_summaries';
}

export interface GraphitiHealthStatus {
  healthy: boolean;
  status?: number;
  statusText?: string;
  code?: string;
  reason?: string;
}

type GraphitiBackendMode = 'mcp' | 'rest';

type GraphitiBackend = {
  mode: GraphitiBackendMode;
  addMessages: (
    groupId: string,
    messages: Array<{
      content: string;
      role_type: 'user' | 'assistant' | 'system';
      role?: string;
      timestamp?: string;
      uuid?: string;
    }>,
    metadata?: Record<string, unknown>,
  ) => Promise<boolean>;
  searchFacts: (
    groupId: string,
    query: string,
    limit?: number,
    options?: {
      centerNodeUuid?: string;
    },
  ) => Promise<SearchResult[]>;
  searchNodes: (
    groupId: string,
    query: string,
    limit?: number,
    options?: {
      entityTypes?: string[];
    },
  ) => Promise<NodeResult[]>;
  getMemory: (
    groupId: string,
    messages: Array<{
      content: string;
      role_type: 'user' | 'assistant' | 'system';
      role: string;
    }>,
    limit?: number,
    filters?: MemoryFilters,
  ) => Promise<{ facts: SearchResult[]; nodes: NodeResult[] }>;
  detectCapabilities: (forceRefresh?: boolean) => Promise<GraphitiCapabilities>;
  healthCheckDetailed: () => Promise<GraphitiHealthStatus>;
  clear: () => Promise<void>;
};

type McpCallToolResult = {
  isError?: boolean;
  structuredContent?: unknown;
  content?: Array<{ type?: string; text?: string }>;
};

function cleanMcpServiceUrl(mcpUrl: string): string {
  return mcpUrl.endsWith('/') ? mcpUrl : `${mcpUrl}/`;
}

function resolveMcpHealthUrl(mcpUrl: string): string {
  const url = new URL(cleanMcpServiceUrl(mcpUrl));
  url.pathname = '/health';
  url.search = '';
  url.hash = '';
  return url.toString();
}

function summarizeConversationForSearch(
  messages: Array<{
    content: string;
    role_type: 'user' | 'assistant' | 'system';
    role: string;
  }>,
): string {
  const recent = messages.slice(-3);
  const lastUser = [...recent].reverse().find((message) => message.role_type === 'user');
  if (lastUser?.content.trim()) {
    return lastUser.content.trim();
  }

  const combined = recent
    .map((message) => `${message.role_type}: ${message.content.trim()}`)
    .filter(Boolean)
    .join('\n');

  return combined.trim();
}

function buildEpisodeName(
  groupId: string,
  messages: Array<{
    content: string;
    role_type: 'user' | 'assistant' | 'system';
    role?: string;
  }>,
): string {
  const firstUser = messages.find((message) => message.role_type === 'user');
  const base = firstUser?.content || messages[0]?.content || 'Conversation memory';
  const normalized = base.replace(/\s+/g, ' ').trim();
  return `${groupId}: ${normalized.slice(0, 72) || 'Conversation memory'}`;
}

function buildEpisodeBody(
  messages: Array<{
    content: string;
    role_type: 'user' | 'assistant' | 'system';
    role?: string;
    timestamp?: string;
  }>,
): string {
  return messages.map((message) => {
    const roleLabel = message.role || message.role_type;
    return `${message.role_type}(${roleLabel}): ${message.content}`;
  }).join('\n').trim();
}

function normalizeFact(raw: Record<string, unknown>): SearchResult {
  return {
    uuid: typeof raw.uuid === 'string' ? raw.uuid : '',
    fact: typeof raw.fact === 'string' ? raw.fact : '',
    source_node_uuid: typeof raw.source_node_uuid === 'string' ? raw.source_node_uuid : '',
    target_node_uuid: typeof raw.target_node_uuid === 'string' ? raw.target_node_uuid : '',
    valid_at: typeof raw.valid_at === 'string' ? raw.valid_at : undefined,
    invalid_at: typeof raw.invalid_at === 'string' ? raw.invalid_at : undefined,
    importance: typeof raw.importance === 'number' ? raw.importance : undefined,
    attributes:
      raw.attributes && typeof raw.attributes === 'object'
        ? (raw.attributes as Record<string, unknown>)
        : undefined,
  };
}

function normalizeNode(raw: Record<string, unknown>): NodeResult {
  return {
    uuid: typeof raw.uuid === 'string' ? raw.uuid : '',
    name: typeof raw.name === 'string' ? raw.name : '',
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    labels: Array.isArray(raw.labels) ? raw.labels.filter((value): value is string => typeof value === 'string') : [],
    created_at: typeof raw.created_at === 'string' ? raw.created_at : '',
    group_id: typeof raw.group_id === 'string' ? raw.group_id : undefined,
    attributes:
      raw.attributes && typeof raw.attributes === 'object'
        ? (raw.attributes as Record<string, unknown>)
        : undefined,
  };
}

function parseMcpStructuredContent<T>(result: McpCallToolResult): T {
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    const structured = result.structuredContent as Record<string, unknown>;
    if (structured.result && typeof structured.result === 'object') {
      return structured.result as T;
    }
    return structured as T;
  }

  const textPayload = result.content
    ?.filter((entry) => entry?.type === 'text' && typeof entry.text === 'string')
    .map((entry) => entry.text)
    .join('\n')
    .trim();

  if (!textPayload) {
    return {} as T;
  }

  try {
    return JSON.parse(textPayload) as T;
  } catch {
    return { message: textPayload } as T;
  }
}

class RestGraphitiBackend implements GraphitiBackend {
  readonly mode: GraphitiBackendMode = 'rest';
  private client: AxiosInstance;
  private capabilitiesCache: GraphitiCapabilities | null = null;

  constructor(config: { baseUrl: string; timeout: number }) {
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async addMessages(
    groupId: string,
    messages: Array<{
      content: string;
      role_type: 'user' | 'assistant' | 'system';
      role?: string;
      timestamp?: string;
      uuid?: string;
    }>,
    metadata?: Record<string, unknown>,
  ): Promise<boolean> {
    const request: AddMessagesRequest = {
      group_id: groupId,
      messages: messages.map((message) => ({
        ...message,
        source_description: 'openclaw-conversation',
      })),
      metadata,
    };

    const response = await this.client.post('/messages', request);
    return response.status === 202;
  }

  async searchFacts(
    groupId: string,
    query: string,
    limit: number = 10,
    options?: {
      centerNodeUuid?: string;
    },
  ): Promise<SearchResult[]> {
    const response = await this.client.post('/search', {
      query,
      group_ids: [groupId],
      max_facts: limit,
      center_node_uuid: options?.centerNodeUuid || null,
    });

    return Array.isArray(response.data?.facts) ? response.data.facts : [];
  }

  async searchNodes(
    groupId: string,
    query: string,
    limit: number = 10,
    options?: {
      entityTypes?: string[];
    },
  ): Promise<NodeResult[]> {
    void groupId;
    void query;
    void limit;
    void options;
    logger.debug('Graphiti REST backend does not expose node search; returning no node results');
    return [];
  }

  async getMemory(
    groupId: string,
    messages: Array<{
      content: string;
      role_type: 'user' | 'assistant' | 'system';
      role: string;
    }>,
    limit: number = 10,
    filters?: MemoryFilters,
  ): Promise<{ facts: SearchResult[]; nodes: NodeResult[] }> {
    const requestBody: Record<string, unknown> = {
      group_id: groupId,
      messages: messages.map((message) => ({
        ...message,
        timestamp: new Date().toISOString(),
      })),
      max_facts: limit,
      center_node_uuid: null,
    };
    void filters;

    const response = await this.client.post('/get-memory', requestBody);
    return response.data || { facts: [], nodes: [] };
  }

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
      const hasCommunityEndpoints = pathKeys.some((path) => /community|communities/i.test(path));
      const addMessagesSchema = openapi.components?.schemas?.AddMessagesRequest;
      const supportsUpdateCommunitiesFlag = Boolean(
        addMessagesSchema?.properties && 'update_communities' in addMessagesSchema.properties,
      );

      this.capabilitiesCache = {
        hasCommunityEndpoints,
        supportsUpdateCommunitiesFlag,
        mode: hasCommunityEndpoints ? 'native_communities' : 'fallback_summaries',
      };
      return this.capabilitiesCache;
    } catch (error) {
      logger.warn(
        'Could not detect Graphiti REST capabilities, defaulting to fallback summaries',
        error,
      );
      this.capabilitiesCache = {
        hasCommunityEndpoints: false,
        supportsUpdateCommunitiesFlag: false,
        mode: 'fallback_summaries',
      };
      return this.capabilitiesCache;
    }
  }

  async healthCheckDetailed(): Promise<GraphitiHealthStatus> {
    try {
      const response = await this.client.get('/healthcheck');
      return {
        healthy: response.status === 200,
        status: response.status,
        statusText: response.statusText,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        return {
          healthy: false,
          status: error.response?.status,
          statusText: error.response?.statusText,
          code: error.code,
          reason: error.message,
        };
      }
      if (error instanceof Error) {
        return {
          healthy: false,
          reason: error.message,
        };
      }
      return {
        healthy: false,
        reason: 'Unknown healthcheck error',
      };
    }
  }

  async clear(): Promise<void> {
    await this.client.post('/clear');
  }
}

class McpGraphitiBackend implements GraphitiBackend {
  readonly mode: GraphitiBackendMode = 'mcp';
  private readonly mcpUrl: string;
  private readonly timeout: number;
  private readonly healthClient: AxiosInstance;
  private clientPromise: Promise<{
    client: any;
    transport: any;
  }> | null = null;

  constructor(config: { mcpUrl: string; timeout: number }) {
    this.mcpUrl = cleanMcpServiceUrl(config.mcpUrl);
    this.timeout = config.timeout;
    this.healthClient = axios.create({
      timeout: this.timeout,
    });
  }

  private async getClient(): Promise<{ client: any; transport: any }> {
    if (!this.clientPromise) {
      this.clientPromise = this.initializeClient();
    }
    return this.clientPromise;
  }

  private async initializeClient(): Promise<{ client: any; transport: any }> {
    // Keep SDK loading CommonJS-friendly for this plugin's current build target.
    const { Client } = require('@modelcontextprotocol/sdk/client') as {
      Client: new (...args: any[]) => any;
    };
    const { StreamableHTTPClientTransport } = require(
      '@modelcontextprotocol/sdk/client/streamableHttp.js',
    ) as {
      StreamableHTTPClientTransport: new (...args: any[]) => any;
    };

    const transport = new StreamableHTTPClientTransport(new URL(this.mcpUrl), {
      requestInit: {
        headers: {
          Accept: 'application/json, text/event-stream',
        },
      },
    });

    const client = new Client(
      {
        name: 'memos',
        version: '0.1.0',
      },
      {},
    );

    await client.connect(transport);
    return { client, transport };
  }

  private async callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { client } = await this.getClient();
    const result = (await client.callTool({
      name,
      arguments: args,
    })) as McpCallToolResult;

    if (result?.isError) {
      const parsed = parseMcpStructuredContent<{ error?: string }>(result);
      throw new Error(parsed.error || `Graphiti MCP tool ${name} failed`);
    }

    return parseMcpStructuredContent<T>(result);
  }

  private resetClient(): void {
    this.clientPromise = null;
  }

  async addMessages(
    groupId: string,
    messages: Array<{
      content: string;
      role_type: 'user' | 'assistant' | 'system';
      role?: string;
      timestamp?: string;
      uuid?: string;
    }>,
    metadata?: Record<string, unknown>,
  ): Promise<boolean> {
    const name = buildEpisodeName(groupId, messages);
    const episodeBody = buildEpisodeBody(messages);
    const sourceDescription =
      typeof metadata?.source_description === 'string'
        ? metadata.source_description
        : 'openclaw-conversation';

    await this.callTool<{ message?: string }>('add_memory', {
      name,
      episode_body: episodeBody,
      group_id: groupId,
      source: 'message',
      source_description: sourceDescription,
    });
    return true;
  }

  async searchFacts(
    groupId: string,
    query: string,
    limit: number = 10,
    options?: {
      centerNodeUuid?: string;
    },
  ): Promise<SearchResult[]> {
    const response = await this.callTool<{ facts?: Array<Record<string, unknown>> }>(
      'search_memory_facts',
      {
        query,
        group_ids: [groupId],
        max_facts: limit,
        center_node_uuid: options?.centerNodeUuid || null,
      },
    );

    return Array.isArray(response.facts) ? response.facts.map(normalizeFact) : [];
  }

  async searchNodes(
    groupId: string,
    query: string,
    limit: number = 10,
    options?: {
      entityTypes?: string[];
    },
  ): Promise<NodeResult[]> {
    const response = await this.callTool<{ nodes?: Array<Record<string, unknown>> }>('search_nodes', {
      query,
      group_ids: [groupId],
      max_nodes: limit,
      entity_types: options?.entityTypes,
    });

    return Array.isArray(response.nodes) ? response.nodes.map(normalizeNode) : [];
  }

  async getMemory(
    groupId: string,
    messages: Array<{
      content: string;
      role_type: 'user' | 'assistant' | 'system';
      role: string;
    }>,
    limit: number = 10,
    filters?: MemoryFilters,
  ): Promise<{ facts: SearchResult[]; nodes: NodeResult[] }> {
    void filters;
    const query = summarizeConversationForSearch(messages);
    if (!query) {
      return { facts: [], nodes: [] };
    }

    const facts = await this.searchFacts(groupId, query, limit);
    return { facts, nodes: [] };
  }

  async detectCapabilities(): Promise<GraphitiCapabilities> {
    return {
      hasCommunityEndpoints: false,
      supportsUpdateCommunitiesFlag: false,
      mode: 'fallback_summaries',
    };
  }

  async healthCheckDetailed(): Promise<GraphitiHealthStatus> {
    try {
      const response = await this.healthClient.get(resolveMcpHealthUrl(this.mcpUrl));
      return {
        healthy: response.status === 200,
        status: response.status,
        statusText: response.statusText,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        return {
          healthy: false,
          status: error.response?.status,
          statusText: error.response?.statusText,
          code: error.code,
          reason: error.message,
        };
      }
      if (error instanceof Error) {
        return {
          healthy: false,
          reason: error.message,
        };
      }
      return {
        healthy: false,
        reason: 'Unknown MCP healthcheck error',
      };
    }
  }

  async clear(): Promise<void> {
    await this.callTool('clear_graph', {});
  }

  markConnectionError(): void {
    this.resetClient();
  }
}

export class GraphitiClient {
  private readonly primaryBackend: GraphitiBackend;
  private readonly secondaryBackend: GraphitiBackend | null;

  constructor(config: GraphitiClientConfig) {
    const timeout = config.timeout || 30000;
    const restUrl = config.baseUrl?.trim();
    const mcpUrl = config.mcpUrl?.trim();
    const preferredBackend = config.backend || 'mcp';
    const canUseRest = Boolean(restUrl);
    const canUseMcp = Boolean(mcpUrl);

    if (preferredBackend === 'mcp' && !canUseMcp && !canUseRest) {
      throw new Error('Graphiti MCP backend selected but neither mcpUrl nor fallback rest URL is configured');
    }
    if (preferredBackend === 'rest' && !canUseRest && !canUseMcp) {
      throw new Error('Graphiti REST backend selected but neither baseUrl nor fallback MCP URL is configured');
    }

    const restBackend = canUseRest ? new RestGraphitiBackend({ baseUrl: restUrl!, timeout }) : null;
    const mcpBackend = canUseMcp ? new McpGraphitiBackend({ mcpUrl: mcpUrl!, timeout }) : null;

    if (preferredBackend === 'mcp') {
      this.primaryBackend = mcpBackend || restBackend!;
      this.secondaryBackend =
        config.enableRestFallback !== false && mcpBackend && restBackend ? restBackend : null;
    } else {
      this.primaryBackend = restBackend || mcpBackend!;
      this.secondaryBackend =
        config.enableRestFallback !== false && restBackend && mcpBackend ? mcpBackend : null;
    }
  }

  private async withFallback<T>(
    operation:
      | 'add_messages'
      | 'search_facts'
      | 'search_nodes'
      | 'get_memory'
      | 'detect_capabilities'
      | 'health_check'
      | 'clear',
    run: (backend: GraphitiBackend) => Promise<T>,
  ): Promise<T> {
    try {
      const result = await run(this.primaryBackend);
      backendRequests.labels(operation, this.primaryBackend.mode, 'ok').inc();
      return result;
    } catch (error) {
      backendRequests.labels(operation, this.primaryBackend.mode, 'error').inc();
      if (this.primaryBackend instanceof McpGraphitiBackend) {
        this.primaryBackend.markConnectionError();
      }
      if (!this.secondaryBackend) {
        throw error;
      }

      logger.warn(
        `Graphiti ${this.primaryBackend.mode.toUpperCase()} backend failed for ${operation}; falling back to ${this.secondaryBackend.mode.toUpperCase()}`,
        error,
      );

      const result = await run(this.secondaryBackend);
      backendRequests.labels(operation, this.secondaryBackend.mode, 'ok').inc();
      return result;
    }
  }

  private async runPrimary<T>(
    operation:
      | 'add_messages'
      | 'search_facts'
      | 'search_nodes'
      | 'get_memory'
      | 'detect_capabilities'
      | 'health_check'
      | 'clear',
    run: (backend: GraphitiBackend) => Promise<T>,
  ): Promise<T> {
    try {
      const result = await run(this.primaryBackend);
      backendRequests.labels(operation, this.primaryBackend.mode, 'ok').inc();
      return result;
    } catch (error) {
      backendRequests.labels(operation, this.primaryBackend.mode, 'error').inc();
      if (this.primaryBackend instanceof McpGraphitiBackend) {
        this.primaryBackend.markConnectionError();
      }
      throw error;
    }
  }

  private async runSecondary<T>(
    operation:
      | 'add_messages'
      | 'search_facts'
      | 'search_nodes'
      | 'get_memory'
      | 'detect_capabilities'
      | 'health_check'
      | 'clear',
    run: (backend: GraphitiBackend) => Promise<T>,
    reason: string,
  ): Promise<T> {
    if (!this.secondaryBackend) {
      throw new Error(`No secondary Graphiti backend available for ${operation}`);
    }

    logger.warn(
      `Graphiti ${this.primaryBackend.mode.toUpperCase()} backend ${reason}; ` +
        `falling back to ${this.secondaryBackend.mode.toUpperCase()} for ${operation}`,
    );

    const result = await run(this.secondaryBackend);
    backendRequests.labels(operation, this.secondaryBackend.mode, 'ok').inc();
    return result;
  }

  async addMessages(
    groupId: string,
    messages: Array<{
      content: string;
      role_type: 'user' | 'assistant' | 'system';
      role?: string;
      timestamp?: string;
      uuid?: string;
    }>,
    metadata?: Record<string, unknown>,
  ): Promise<boolean> {
    return await this.withFallback('add_messages', (backend) =>
      backend.addMessages(groupId, messages, metadata),
    );
  }

  async searchFacts(
    groupId: string,
    query: string,
    limit: number = 10,
    options?: {
      centerNodeUuid?: string;
    },
  ): Promise<SearchResult[]> {
    try {
      return await this.runPrimary('search_facts', (backend) =>
        backend.searchFacts(groupId, query, limit, options),
      );
    } catch (error) {
      if (!this.secondaryBackend) {
        throw error;
      }
      return await this.runSecondary(
        'search_facts',
        (backend) => backend.searchFacts(groupId, query, limit, options),
        'failed',
      );
    }
  }

  async searchNodes(
    groupId: string,
    query: string,
    limit: number = 10,
    options?: {
      entityTypes?: string[];
    },
  ): Promise<NodeResult[]> {
    return await this.withFallback('search_nodes', (backend) =>
      backend.searchNodes(groupId, query, limit, options),
    );
  }

  async getMemory(
    groupId: string,
    messages: Array<{
      content: string;
      role_type: 'user' | 'assistant' | 'system';
      role: string;
    }>,
    limit: number = 10,
    filters?: MemoryFilters,
  ): Promise<{ facts: SearchResult[]; nodes: NodeResult[] }> {
    return await this.withFallback('get_memory', (backend) =>
      backend.getMemory(groupId, messages, limit, filters),
    );
  }

  async detectCapabilities(forceRefresh: boolean = false): Promise<GraphitiCapabilities> {
    void forceRefresh;
    return await this.withFallback('detect_capabilities', (backend) => backend.detectCapabilities());
  }

  async healthCheck(): Promise<boolean> {
    const status = await this.healthCheckDetailed();
    return status.healthy;
  }

  async healthCheckDetailed(): Promise<GraphitiHealthStatus> {
    return await this.withFallback('health_check', (backend) => backend.healthCheckDetailed());
  }

  async clear(): Promise<void> {
    await this.withFallback('clear', (backend) => backend.clear());
  }
}

export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  retries: number = 3,
): Promise<T> {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const axiosError = error as AxiosError;

      if (axiosError.response?.status === 429 && attempt < retries - 1) {
        const delay = 1000 * Math.pow(2, attempt);
        logger.warn(
          `Rate limited by Graphiti, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`,
        );
        await sleep(delay);
        continue;
      }

      if (axiosError.code === 'ECONNREFUSED' || axiosError.code === 'ENOTFOUND') {
        logger.error('Graphiti backend unavailable');
        throw new Error('Graphiti backend unavailable');
      }

      throw error;
    }
  }

  throw new Error('Max retries exceeded');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
