"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatFactsAsContext = formatFactsAsContext;
exports.buildQueryFromMessages = buildQueryFromMessages;
exports.recallHook = recallHook;
const department_1 = require("../utils/department");
/**
 * Format search results into context for the agent
 * @param facts Array of fact results
 * @returns Formatted context string
 */
function formatFactsAsContext(facts) {
    if (facts.length === 0) {
        return '';
    }
    let context = '## Relevant Context from Memory\n\n';
    // Add facts
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
        // Convert messages to Graphiti format
        const graphitiMessages = ctx.messages.slice(-3).map(m => ({
            content: m.content,
            role_type: m.role,
        }));
        // Get memory from Graphiti
        const memory = await client.getMemory(department, graphitiMessages, config.recall_limit);
        // Format results into context
        const context = formatFactsAsContext(memory.facts);
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