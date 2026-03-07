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
}
export interface SearchResult {
    uuid: string;
    fact: string;
    source_node_uuid: string;
    target_node_uuid: string;
    valid_at?: string;
    invalid_at?: string;
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
export declare class GraphitiClient {
    private client;
    constructor(config: GraphitiClientConfig);
    /**
     * Add messages to the knowledge graph
     * @param groupId The department/group ID (e.g., "ops", "devops")
     * @param messages Array of messages to add
     * @returns Success status
     */
    addMessages(groupId: string, messages: Array<{
        content: string;
        role_type: 'user' | 'assistant';
        role?: string;
        timestamp?: string;
    }>): Promise<boolean>;
    /**
     * Search for facts/relationships in the graph
     * @param groupId The department/group ID
     * @param query Search query
     * @param limit Maximum number of results
     * @returns Array of search results
     */
    searchFacts(groupId: string, query: string, limit?: number): Promise<SearchResult[]>;
    /**
     * Get memory for a conversation context
     * @param groupId The department/group ID
     * @param messages Current conversation messages
     * @param limit Maximum number of facts
     * @returns Memory results
     */
    getMemory(groupId: string, messages: Array<{
        content: string;
        role_type: 'user' | 'assistant';
    }>, limit?: number): Promise<{
        facts: SearchResult[];
        nodes: NodeResult[];
    }>;
    /**
     * Check if Graphiti server is healthy
     * @returns True if healthy
     */
    healthCheck(): Promise<boolean>;
    /**
     * Clear all data (use with caution)
     */
    clear(): Promise<void>;
}
/**
 * Retry a Graphiti operation with exponential backoff
 * @param operation The operation to retry
 * @param retries Maximum number of retries
 * @returns Result of the operation
 */
export declare function retryWithBackoff<T>(operation: () => Promise<T>, retries?: number): Promise<T>;
//# sourceMappingURL=graphiti-client.d.ts.map