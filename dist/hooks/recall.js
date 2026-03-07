"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatFactsAsContext = formatFactsAsContext;
exports.buildQueryFromMessages = buildQueryFromMessages;
exports.recallHook = recallHook;
const department_1 = require("../utils/department");
/**
 * Format search results into context for the agent
 * @param facts Array of fact results
 * @param nodes Array of node results
 * @returns Formatted context string
 */
function formatFactsAsContext(facts, nodes) {
    if (facts.length === 0 && nodes.length === 0) {
        return '';
    }
    let context = '## Relevant Context from Memory\n\n';
    // Add entities if present
    if (nodes.length > 0) {
        context += '**Entities:**\n';
        for (const node of nodes) {
            const labels = node.labels.join(', ');
            context += `- **${node.name}** (${labels})\n`;
        }
        context += '\n';
    }
    // Add facts
    if (facts.length > 0) {
        context += '**Facts:**\n';
        for (const fact of facts) {
            context += `- ${fact.fact}`;
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
function buildQueryFromMessages(messages) {
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
    // (Graphiti will do semantic search on this)
    return userMessages[userMessages.length - 1];
}
/**
 * Hook called at before_prompt_build to recall relevant facts
 * @param event The hook event
 * @param ctx The plugin context
 * @param config MEMOS configuration
 * @param client Graphiti client
 * @returns Object with context to inject
 */
async function recallHook(event, ctx, config, client) {
    // Check if auto-recall is enabled
    if (!config.auto_recall) {
        return {};
    }
    // Resolve department from agent_id
    const department = (0, department_1.resolveDepartment)(ctx.agentId, config);
    if (!department) {
        console.warn(`No department found for agent ${ctx.agentId}`);
        return {};
    }
    // Build query from recent messages
    const query = buildQueryFromMessages(ctx.messages);
    if (!query) {
        return {};
    }
    try {
        // Search Graphiti for relevant facts
        const facts = await client.searchFacts(department, query, config.recall_limit);
        // Also search for nodes if we didn't get many facts
        let nodes = [];
        if (facts.length < 3) {
            nodes = await client.searchNodes(department, query, 5);
        }
        // Format results into context
        const context = formatFactsAsContext(facts, nodes);
        if (context) {
            return { prependSystemContext: context };
        }
        return {};
    }
    catch (error) {
        console.error('Failed to recall from memory:', error);
        // Return empty context on error - don't break the agent run
        return {};
    }
}
//# sourceMappingURL=recall.js.map