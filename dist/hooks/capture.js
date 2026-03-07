"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureHook = captureHook;
const graphiti_client_1 = require("../graphiti-client");
const department_1 = require("../utils/department");
const filter_1 = require("../utils/filter");
/**
 * Hook called at agent_end to capture episodes
 * @param event The hook event
 * @param ctx The plugin context
 * @param config MEMOS configuration
 * @param client Graphiti client
 */
async function captureHook(event, ctx, config, client) {
    // Check if auto-capture is enabled
    if (!config.auto_capture) {
        return;
    }
    // Resolve department from agent_id
    const department = (0, department_1.resolveDepartment)(ctx.agentId, config);
    if (!department) {
        console.warn(`No department found for agent ${ctx.agentId}`);
        return;
    }
    // Get the last user-assistant exchange
    const { lastUser, lastAssistant } = (0, filter_1.getLastExchange)(ctx.messages);
    if (!lastUser || !lastAssistant) {
        console.warn('Could not find complete user-assistant exchange');
        return;
    }
    // Check if exchange is worth remembering
    if (!(0, filter_1.isWorthRemembering)(lastUser, lastAssistant)) {
        console.log('Exchange filtered as trivial, not capturing');
        return;
    }
    // Build episode content
    const content = (0, filter_1.buildEpisodeContent)(lastUser, lastAssistant);
    // Build metadata
    const timestamp = Date.now();
    const metadata = {
        agent_id: ctx.agentId,
        user_id: ctx.userId || 'unknown',
        session_id: ctx.sessionId || 'unknown',
        channel: ctx.channel || 'unknown',
        timestamp,
    };
    try {
        // Send to Graphiti with retry logic
        await (0, graphiti_client_1.retryWithBackoff)(() => client.addEpisode(department, content, metadata), config.rate_limit_retries);
        console.log(`Successfully captured episode for agent ${ctx.agentId} in department ${department}`);
    }
    catch (error) {
        console.error('Failed to capture episode:', error);
        // Log but don't throw - we don't want to break the agent run
    }
}
//# sourceMappingURL=capture.js.map