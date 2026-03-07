"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultConfig = void 0;
exports.validateConfig = validateConfig;
/**
 * Default configuration
 */
exports.defaultConfig = {
    graphiti_url: 'http://localhost:8000',
    sop_search_enabled: false,
    sop_path: '~/.openclaw/workspace/sop',
    auto_capture: true,
    auto_recall: true,
    recall_limit: 10,
    rate_limit_retries: 3,
};
/**
 * Validate the configuration
 * @param config Configuration object
 * @throws Error if configuration is invalid
 */
function validateConfig(config) {
    if (!config || typeof config !== 'object') {
        throw new Error('MEMOS configuration must be an object');
    }
    const c = config;
    // Check departments
    if (!c.departments || typeof c.departments !== 'object') {
        throw new Error('MEMOS configuration requires "departments" object');
    }
    // Validate each department has an array of agent IDs
    for (const [dept, agents] of Object.entries(c.departments)) {
        if (!Array.isArray(agents)) {
            throw new Error(`Department "${dept}" must be an array of agent IDs`);
        }
    }
    // Check graphiti_url
    if (c.graphiti_url !== undefined && typeof c.graphiti_url !== 'string') {
        throw new Error('graphiti_url must be a string');
    }
    // Check other numeric/boolean fields
    const booleanFields = ['sop_search_enabled', 'auto_capture', 'auto_recall'];
    for (const field of booleanFields) {
        if (c[field] !== undefined && typeof c[field] !== 'boolean') {
            throw new Error(`${field} must be a boolean`);
        }
    }
    const numericFields = ['recall_limit', 'rate_limit_retries'];
    for (const field of numericFields) {
        if (c[field] !== undefined && typeof c[field] !== 'number') {
            throw new Error(`${field} must be a number`);
        }
    }
}
//# sourceMappingURL=config.js.map