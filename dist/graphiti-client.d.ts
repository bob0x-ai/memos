export interface EpisodeMetadata {
    agent_id: string;
    user_id: string;
    session_id: string;
    channel: string;
    timestamp: number;
}
export interface AddEpisodeRequest {
    name: string;
    episode_body: string;
    source: 'text' | 'json';
    source_description: string;
    reference_time: string;
    group_id: string;
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
     * Add an episode to the knowledge graph
     * @param groupId The department/group ID (e.g., "ops", "devops")
     * @param content The episode content (user + assistant messages)
     * @param metadata Episode metadata including agent_id, user_id, session_id
     * @returns The created episode UUID
     */
    addEpisode(groupId: string, content: string, metadata: EpisodeMetadata): Promise<string>;
    /**
     * Search for facts/relationships in the graph
     * @param groupId The department/group ID
     * @param query Search query
     * @param limit Maximum number of results
     * @returns Array of search results
     */
    searchFacts(groupId: string, query: string, limit?: number): Promise<SearchResult[]>;
    /**
     * Search for nodes/entities in the graph
     * @param groupId The department/group ID
     * @param query Search query
     * @param limit Maximum number of results
     * @returns Array of node results
     */
    searchNodes(groupId: string, query: string, limit?: number): Promise<NodeResult[]>;
    /**
     * Check if Graphiti server is healthy
     * @returns True if healthy
     */
    healthCheck(): Promise<boolean>;
    /**
     * Get Graphiti server status
     * @returns Status information
     */
    getStatus(): Promise<unknown>;
}
/**
 * Retry a Graphiti operation with exponential backoff
 * @param operation The operation to retry
 * @param retries Maximum number of retries
 * @returns Result of the operation
 */
export declare function retryWithBackoff<T>(operation: () => Promise<T>, retries?: number): Promise<T>;
//# sourceMappingURL=graphiti-client.d.ts.map