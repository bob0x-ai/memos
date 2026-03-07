"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GraphitiClient = void 0;
exports.retryWithBackoff = retryWithBackoff;
const axios_1 = __importDefault(require("axios"));
class GraphitiClient {
    client;
    constructor(config) {
        this.client = axios_1.default.create({
            baseURL: config.baseUrl,
            timeout: config.timeout || 30000,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }
    /**
     * Add an episode to the knowledge graph
     * @param groupId The department/group ID (e.g., "ops", "devops")
     * @param content The episode content (user + assistant messages)
     * @param metadata Episode metadata including agent_id, user_id, session_id
     * @returns The created episode UUID
     */
    async addEpisode(groupId, content, metadata) {
        const request = {
            name: `episode_${metadata.timestamp}`,
            episode_body: content,
            source: 'text',
            source_description: metadata.channel,
            reference_time: new Date().toISOString(),
            group_id: groupId,
        };
        const response = await this.client.post('/add_episode', request);
        return response.data.uuid;
    }
    /**
     * Search for facts/relationships in the graph
     * @param groupId The department/group ID
     * @param query Search query
     * @param limit Maximum number of results
     * @returns Array of search results
     */
    async searchFacts(groupId, query, limit = 10) {
        const response = await this.client.post('/search', {
            query,
            group_ids: [groupId],
            num_results: limit,
        });
        return response.data.results || [];
    }
    /**
     * Search for nodes/entities in the graph
     * @param groupId The department/group ID
     * @param query Search query
     * @param limit Maximum number of results
     * @returns Array of node results
     */
    async searchNodes(groupId, query, limit = 10) {
        const response = await this.client.post('/search_nodes', {
            query,
            group_ids: [groupId],
            num_results: limit,
        });
        return response.data.results || [];
    }
    /**
     * Check if Graphiti server is healthy
     * @returns True if healthy
     */
    async healthCheck() {
        try {
            const response = await this.client.get('/health');
            return response.status === 200;
        }
        catch {
            return false;
        }
    }
    /**
     * Get Graphiti server status
     * @returns Status information
     */
    async getStatus() {
        const response = await this.client.get('/status');
        return response.data;
    }
}
exports.GraphitiClient = GraphitiClient;
/**
 * Retry a Graphiti operation with exponential backoff
 * @param operation The operation to retry
 * @param retries Maximum number of retries
 * @returns Result of the operation
 */
async function retryWithBackoff(operation, retries = 3) {
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            return await operation();
        }
        catch (error) {
            const axiosError = error;
            // Check if it's a rate limit error (429)
            if (axiosError.response?.status === 429 && attempt < retries - 1) {
                const delay = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
                console.warn(`Rate limited by Graphiti, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
                await sleep(delay);
                continue;
            }
            // Check if Graphiti server is unavailable
            if (axiosError.code === 'ECONNREFUSED' || axiosError.code === 'ENOTFOUND') {
                console.error('Graphiti server unavailable');
                throw new Error('Graphiti server unavailable');
            }
            throw error;
        }
    }
    throw new Error('Max retries exceeded');
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
//# sourceMappingURL=graphiti-client.js.map