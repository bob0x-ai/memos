"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isWorthRemembering = isWorthRemembering;
exports.getLastExchange = getLastExchange;
exports.buildEpisodeContent = buildEpisodeContent;
/**
 * Check if a conversation exchange is worth remembering
 * Filters out pleasantries, acknowledgments, and trivial messages
 *
 * @param userMsg The user's message
 * @param assistantMsg The assistant's response
 * @returns True if worth remembering, false otherwise
 */
function isWorthRemembering(userMsg, assistantMsg) {
    const combined = `${userMsg} ${assistantMsg}`.toLowerCase().trim();
    // Skip empty exchanges
    if (!combined)
        return false;
    // Skip very short exchanges (< 50 chars) - likely trivial
    if (combined.length < 50)
        return false;
    // Skip if it's just pleasantries and acknowledgment patterns
    const pleasantries = [
        'thanks', 'thank you', 'ok', 'okay', 'got it',
        'sounds good', 'will do', "you're welcome", 'sure',
        'great', 'nice', 'perfect', 'awesome'
    ];
    // Check if the entire message is just pleasantries
    const isJustPleasantries = pleasantries.some(p => combined === p || combined === `${p}.` || combined === `${p}!`);
    if (isJustPleasantries)
        return false;
    // Check if mostly pleasantries and short
    if (combined.length < 100) {
        const hasPleasantry = pleasantries.some(p => combined.includes(p));
        if (hasPleasantry)
            return false;
    }
    // Skip standalone acknowledgments (just "ok", "thanks", etc.)
    const ackPattern = /^(ok|okay|got it|thanks|thank you|sure|yes|no|yep|nope)[\.\!\?]*$/i;
    if (ackPattern.test(userMsg.trim()))
        return false;
    return true;
}
/**
 * Extract the last user and assistant messages from context
 * @param messages Array of messages
 * @returns Object with lastUser and lastAssistant messages
 */
function getLastExchange(messages) {
    // Find last user message
    let lastUser = '';
    let lastAssistant = '';
    // Iterate backwards to find the last user-assistant exchange
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role === 'assistant' && !lastAssistant) {
            lastAssistant = msg.content;
        }
        else if (msg.role === 'user' && !lastUser) {
            lastUser = msg.content;
        }
        // If we found both, break
        if (lastUser && lastAssistant)
            break;
    }
    return { lastUser, lastAssistant };
}
/**
 * Build episode content from user and assistant messages
 * @param lastUser The last user message
 * @param lastAssistant The last assistant message
 * @returns Formatted episode content
 */
function buildEpisodeContent(lastUser, lastAssistant) {
    return `USER: ${lastUser}\nASSISTANT: ${lastAssistant}`.trim();
}
//# sourceMappingURL=filter.js.map