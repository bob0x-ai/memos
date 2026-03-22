import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  buildManagementRecallQueries,
  buildQueryFromMessages,
  formatFactsAsContext,
  recallHook,
} from '../hooks/recall';
import { getMetrics, resetMetrics } from '../metrics/prometheus';
import { MemosConfig } from '../config';

const mockGetAgentConfig = jest.fn();
const mockGetGroupsForRecall = jest.fn();
const mockLoadConfig = jest.fn();

jest.mock('../utils/config', () => ({
  getAgentConfig: (...args: unknown[]) => mockGetAgentConfig(...args),
  getGroupsForRecall: (...args: unknown[]) => mockGetGroupsForRecall(...args),
  loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
}));

describe('Recall Hook', () => {
  let mockClient: any;
  let mockConfig: MemosConfig;
  let mockCtx: { agentId: string; messages: Array<{ role: string; content: string }> };

  beforeEach(() => {
    resetMetrics();
    mockGetAgentConfig.mockReset().mockReturnValue({
      role: 'worker',
      access_level: 'restricted',
      department: 'test-devops',
      capture: { enabled: true, scope: 'department' },
      recall: {
        mode: 'facts',
        scopes: ['department', 'company'],
        max_results: 10,
        min_importance: 2,
      },
    });
    mockGetGroupsForRecall.mockReset().mockReturnValue(['test-devops', 'company']);
    mockLoadConfig.mockReset().mockReturnValue({
      summarization: { cache_ttl_hours: 4 },
      llm: { model: 'gpt-4o-mini', prompts: { summarization_system: 'sum' } },
    });

    mockClient = {
      detectCapabilities: jest.fn(async () => ({
        mode: 'fallback_summaries',
        hasCommunityEndpoints: false,
        supportsUpdateCommunitiesFlag: false,
      })),
      searchNodes: jest.fn(async () => []),
      searchFacts: jest.fn(async () => [
        {
          uuid: 'fact-1',
          fact: 'The server runs on port 8080.',
          importance: 3,
          valid_at: new Date().toISOString(),
        },
      ]),
    };

    mockConfig = {
      auto_recall: true,
      recall_limit: 5,
    } as MemosConfig;

    mockCtx = {
      agentId: 'test-kernel',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'How do I access the server?' },
      ],
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('recalls facts for fact-mode roles from the resolved groups', async () => {
    const result = await recallHook({}, mockCtx, mockConfig, mockClient);

    expect(result.prependSystemContext).toContain('port 8080');
    expect(mockGetGroupsForRecall).toHaveBeenCalledWith('test-kernel', expect.any(Object));
    expect(mockClient.searchFacts).toHaveBeenCalledWith(
      'test-devops',
      'How do I access the server?',
      expect.any(Number),
    );
    expect(mockClient.searchFacts).toHaveBeenCalledWith(
      'company',
      'How do I access the server?',
      expect.any(Number),
    );
  });

  it('uses centered fact retry for fact-mode roles when the first fact search misses', async () => {
    mockClient.searchFacts
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          uuid: 'fact-2',
          fact: 'The MCP endpoint runs on port 8001.',
          importance: 3,
        },
      ]);
    mockClient.searchNodes
      .mockReset()
      .mockResolvedValueOnce([
        {
          uuid: 'node-1',
          name: 'graphiti mcp',
          summary: 'The Graphiti MCP endpoint runs on port 8001.',
          labels: ['Service'],
          created_at: new Date().toISOString(),
          group_id: 'company',
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await recallHook({}, mockCtx, mockConfig, mockClient);

    expect(result.prependSystemContext).toContain('port 8001');
    expect(mockClient.searchNodes).toHaveBeenCalled();
    expect(mockClient.searchFacts).toHaveBeenLastCalledWith(
      'company',
      'How do I access the server?',
      expect.any(Number),
      { centerNodeUuid: 'node-1' },
    );
  });

  it('uses node-summary fallback only for summary-mode roles', async () => {
    mockGetAgentConfig.mockReturnValue({
      role: 'management',
      access_level: 'confidential',
      department: 'ops',
      capture: { enabled: true, scope: 'private' },
      recall: {
        mode: 'summary',
        scopes: ['self', 'department', 'company'],
        max_results: 5,
        min_importance: 1,
      },
    });
    mockGetGroupsForRecall.mockReturnValue(['test-kernel', 'ops', 'company']);
    mockClient.searchFacts
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mockClient.searchNodes
      .mockReset()
      .mockResolvedValueOnce([
        {
          uuid: 'node-1',
          name: 'server endpoint',
          summary: 'The server is reachable through the MCP endpoint on port 8001.',
          labels: ['Service'],
          created_at: new Date().toISOString(),
          group_id: 'ops',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await recallHook({}, mockCtx, mockConfig, mockClient);

    expect(result.prependSystemContext).toContain('Executive Memory Summary');
    expect(result.prependSystemContext).toContain('port 8001');
    const metrics = await getMetrics();
    expect(metrics).toContain('memos_summary_retrieval_sources_total{agent_id="test-kernel",source="nodes",outcome="hit"} 1');
  });

  it('stays quiet for startup-only sessions with no surviving user topic', async () => {
    mockGetAgentConfig.mockReturnValue({
      role: 'management',
      access_level: 'confidential',
      department: 'ops',
      capture: { enabled: true, scope: 'private' },
      recall: {
        mode: 'summary',
        scopes: ['self', 'department', 'company'],
        max_results: 5,
        min_importance: 1,
      },
    });
    mockCtx.messages = [
      {
        role: 'assistant',
        content: '(session bootstrap) The assistant runs the Session Startup sequence upon starting a new session.',
      },
      {
        role: 'assistant',
        content: 'The assistant session context was generated by memos-auto-capture.',
      },
    ];

    const result = await recallHook({}, mockCtx, mockConfig, mockClient);

    expect(result.prependSystemContext).toBeUndefined();
    expect(result.monitorAttempted).toBe(true);
    expect(mockClient.searchFacts).not.toHaveBeenCalled();
  });

  it('builds a topic-grouped management summary without unrelated blockers', async () => {
    mockGetAgentConfig.mockReturnValue({
      role: 'management',
      access_level: 'confidential',
      department: 'ops',
      capture: { enabled: true, scope: 'private' },
      recall: {
        mode: 'summary',
        scopes: ['self', 'department', 'company'],
        max_results: 5,
        min_importance: 1,
      },
    });
    mockGetGroupsForRecall.mockReturnValue(['test-kernel', 'ops', 'company']);
    mockCtx.messages = [
      { role: 'user', content: 'What changed in the memos plugin retrieval?' },
    ];
    mockClient.searchFacts.mockReset().mockImplementation(async (groupId: string) => {
      if (groupId === 'test-kernel') {
        return [
          {
            uuid: 'm1',
            fact: 'The memos plugin retrieval now parses nested MCP search results correctly.',
            importance: 4,
          },
        ];
      }
      if (groupId === 'ops') {
        return [
          {
            uuid: 'd1',
            fact: 'Staging rollout is currently blocked by FR-218.',
            importance: 4,
          },
        ];
      }
      return [];
    });

    const result = await recallHook({}, mockCtx, mockConfig, mockClient);

    expect(result.prependSystemContext).toContain('Executive Memory Summary');
    expect(result.prependSystemContext).toContain('Topic:');
    expect(result.prependSystemContext).toContain('memos plugin retrieval');
    expect(result.prependSystemContext).not.toContain('FR-218');
    expect(result.prependSystemContext).not.toContain('Source facts:');
  });

  it('returns no context when every summary retrieval stage misses', async () => {
    mockGetAgentConfig.mockReturnValue({
      role: 'management',
      access_level: 'confidential',
      department: 'ops',
      capture: { enabled: true, scope: 'private' },
      recall: {
        mode: 'summary',
        scopes: ['self', 'department', 'company'],
        max_results: 5,
        min_importance: 2,
      },
    });
    mockGetGroupsForRecall.mockReturnValue(['test-kernel', 'ops', 'company']);
    mockClient.searchFacts.mockReset().mockResolvedValue([]);
    mockClient.searchNodes.mockReset().mockResolvedValue([]);

    const result = await recallHook({}, mockCtx, mockConfig, mockClient);

    expect(result.prependSystemContext).toBeUndefined();
    const metrics = await getMetrics();
    expect(metrics).toContain('memos_summary_retrieval_outcomes_total{agent_id="test-kernel",outcome="node_summary_miss"} 1');
  });

  it('suppresses banal recalled facts before context injection', async () => {
    mockClient.searchFacts.mockResolvedValue([
      {
        uuid: 'fact-1',
        fact: 'Standing by for further instructions.',
        importance: 3,
      },
      {
        uuid: 'fact-2',
        fact: 'The deployment endpoint is https://ops.example.com and the API listens on port 8080.',
        importance: 3,
      },
    ]);

    const result = await recallHook({}, mockCtx, mockConfig, mockClient);

    expect(result.prependSystemContext).toContain('https://ops.example.com');
    expect(result.prependSystemContext).not.toContain('Standing by');
  });

  describe('formatFactsAsContext', () => {
    it('formats facts as a simple flat list', () => {
      const result = formatFactsAsContext([
        { uuid: '1', fact: 'Test fact', valid_at: new Date().toISOString() },
      ]);

      expect(result).toContain('Relevant Context from Memory');
      expect(result).toContain('Test fact');
    });

    it('returns an empty string for no facts', () => {
      expect(formatFactsAsContext([])).toBe('');
    });
  });

  describe('buildQueryFromMessages', () => {
    it('extracts the last user message', () => {
      expect(
        buildQueryFromMessages([
          { role: 'user', content: 'First question' },
          { role: 'assistant', content: 'First answer' },
          { role: 'user', content: 'Second question' },
        ]),
      ).toBe('Second question');
    });
  });

  describe('buildManagementRecallQueries', () => {
    it('includes durable assistant context in the primary query', () => {
      const queries = buildManagementRecallQueries([
        { role: 'assistant', content: 'The MEMOS metrics endpoint is `/plugins/memos/metrics` and auth must be plugin.' },
        { role: 'user', content: 'Still testing the memos plugin context monitoring.' },
      ]);

      expect(queries.primaryQuery).toContain('Still testing the memos plugin context monitoring.');
      expect(queries.primaryQuery).toContain('/plugins/memos/metrics');
      expect(queries.fallbackQuery).toContain('auth must be plugin');
    });
  });
});
