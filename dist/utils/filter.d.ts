/**
 * Check if a conversation exchange is worth remembering
 * Filters out pleasantries, acknowledgments, and trivial messages
 *
 * @param userMsg The user's message
 * @param assistantMsg The assistant's response
 * @returns True if worth remembering, false otherwise
 */
export declare function isWorthRemembering(userMsg: string, assistantMsg: string): boolean;
/**
 * Extract the last user and assistant messages from context
 * @param messages Array of messages
 * @returns Object with lastUser and lastAssistant messages
 */
export declare function getLastExchange(messages: Array<{
    role: string;
    content: string;
}>): {
    lastUser: string;
    lastAssistant: string;
};
/**
 * Build episode content from user and assistant messages
 * @param lastUser The last user message
 * @param lastAssistant The last assistant message
 * @returns Formatted episode content
 */
export declare function buildEpisodeContent(lastUser: string, lastAssistant: string): string;
//# sourceMappingURL=filter.d.ts.map