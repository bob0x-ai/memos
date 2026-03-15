import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { recallHook, formatFactsAsContext, buildQueryFromMessages, rrfRerank } from '../hooks/recall';
import { GraphitiClient } from '../graphiti-client';
import { MemosConfig } from '../config';

jest.mock('../utils/config', () => ({
  COMPANY_DEPARTMENT_ID: 'company',
  getAgentConfig: jest.fn().mockReturnValue({
    role: 'worker',
    access_level: 'restricted',
    department: 'test-devops',
    capture: {
      enabled: true
    },
    recall: {
      content_types: ['fact', 'learning', 'warning', 'sop'],
      max_results: 10,
      reranker: 'rrf',
      min_importance: 2,
      department_scope: 'own'
    }
  }),
  getDepartmentsForRecall: jest.fn((agentConfig: any) => (
    agentConfig?.access_level === 'confidential' ||
    agentConfig?.recall?.department_scope === 'all' ||
    !agentConfig?.department
      ? ['test-ops', 'test-devops', 'company']
      : [agentConfig.department, 'company']
  )),
  loadConfig: jest.fn().mockReturnValue({
    ontology: {
      content_types: ['fact', 'decision', 'preference', 'learning', 'summary', 'sop', 'warning', 'contact']
    },
    summarization: {
      cache_ttl_hours: 4
    },
    llm: {
      model: 'gpt-4o-mini'
    },
    agents: {
      'test-kernel': {
        access_level: 'restricted',
        department: 'test-devops',
        recall: {
          content_types: ['fact', 'learning', 'warning', 'sop'],
          max_results: 10,
          reranker: 'rrf',
          min_importance: 2
        }
      }
    }
  })
}));

describe('Recall Hook', () => {
  let mockClient: any;
  let mockConfig: MemosConfig;
  let mockCtx: any;
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockClient = {
      detectCapabilities: jest.fn(async () => ({
        mode: 'fallback_summaries',
        hasCommunityEndpoints: false,
        supportsUpdateCommunitiesFlag: false
      })),
      getMemory: jest.fn(async () => ({
        facts: [
          {
            uuid: 'fact-1',
            fact: 'The server runs on port 8080',
            valid_at: new Date().toISOString()
          },
          {
            uuid: 'fact-2',
            fact: 'Kendra is the Stripe admin',
            valid_at: new Date().toISOString()
          }
        ],
        nodes: []
      }))
    };

    mockConfig = {
      auto_recall: true,
      recall_limit: 5,
      departments: {
        'test-devops': ['test-kernel']
      }
    } as any;

    mockCtx = {
      agentId: 'test-kernel',
      messages: [
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'How do I access the server?' }
      ]
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should recall memories', async () => {
    const result = await recallHook({}, mockCtx, mockConfig, mockClient);

    expect(result.prependSystemContext).toBeDefined();
    expect(result.prependSystemContext).toContain('port 8080');
  });

  it('should query own department plus company for worker recall', async () => {
    await recallHook({}, mockCtx, mockConfig, mockClient);

    expect(mockClient.getMemory).toHaveBeenCalledWith(
      'test-devops',
      expect.any(Array),
      expect.any(Number),
      expect.any(Object)
    );
    expect(mockClient.getMemory).toHaveBeenCalledWith(
      'company',
      expect.any(Array),
      expect.any(Number),
      expect.any(Object)
    );
  });

  it('should use cross_encoder reranker for management agents', async () => {
    const { getAgentConfig } = require('../utils/config');
    getAgentConfig.mockReturnValue({
      role: 'management',
      access_level: 'confidential',
      department: 'test-management',
      capture: {
        enabled: true
      },
      recall: {
        content_types: ['fact', 'learning', 'warning', 'sop'],
        max_results: 10,
        reranker: 'cross_encoder',
        min_importance: 2,
        department_scope: 'all'
      }
    });

    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"ranked_ids":["fact-2","fact-1"]}'
            }
          }
        ]
      })
    })) as any;

    const result = await recallHook({}, mockCtx, mockConfig, mockClient);

    expect(global.fetch).toHaveBeenCalled();
    expect(result.prependSystemContext).toBeDefined();
    expect(result.prependSystemContext!.indexOf('Kendra is the Stripe admin'))
      .toBeLessThan(result.prependSystemContext!.indexOf('The server runs on port 8080'));
  });

  it('should generate summary context for summary-only policy agents', async () => {
    const { getAgentConfig } = require('../utils/config');
    getAgentConfig.mockReturnValue({
      role: 'management',
      access_level: 'confidential',
      department: 'test-ops',
      capture: {
        enabled: true
      },
      recall: {
        content_types: ['summary'],
        max_results: 5,
        reranker: 'cross_encoder',
        min_importance: 1,
        department_scope: 'all'
      }
    });

    const result = await recallHook({}, mockCtx, mockConfig, mockClient);

    expect(mockClient.detectCapabilities).toHaveBeenCalled();
    expect(result.prependSystemContext).toContain('Executive Memory Summary');
    expect(result.prependSystemContext).toContain('Summary ID:');
  });

  it('should skip when auto_recall is disabled', async () => {
    mockConfig.auto_recall = false;
    const result = await recallHook({}, mockCtx, mockConfig, mockClient);

    expect(mockClient.getMemory).not.toHaveBeenCalled();
    expect(result.prependSystemContext).toBeUndefined();
  });

  it('should handle empty results', async () => {
    mockClient.getMemory.mockResolvedValue({ facts: [], nodes: [] });
    const result = await recallHook({}, mockCtx, mockConfig, mockClient);

    expect(result.prependSystemContext).toBeUndefined();
  });

  it('should handle errors gracefully', async () => {
    mockClient.getMemory.mockRejectedValue(new Error('Graphiti error'));
    const result = await recallHook({}, mockCtx, mockConfig, mockClient);

    expect(result.prependSystemContext).toBeUndefined();
  });

  it('should filter tool results and synthetic summary/retry messages from recall context', async () => {
    mockCtx.messages = [
      {
        role: 'user',
        content: '## Executive Memory Summary\n\nSummary ID: sum_deadbeef\n\nBlocked deployment.\n',
      },
      {
        role: 'user',
        content: 'Continue where you left off. The previous model attempt failed or timed out.',
      },
      {
        role: 'toolResult',
        content: '{ "success": true, "facts": ["debug"] }',
      },
      {
        role: 'assistant',
        content: 'Previous answer with useful context.',
      },
      {
        role: 'user',
        content: 'What do we know about OPS-431 right now?',
      },
    ];

    await recallHook({}, mockCtx, mockConfig, mockClient);

    expect(mockClient.getMemory).toHaveBeenCalled();
    const passedMessages = mockClient.getMemory.mock.calls[0][1];
    expect(passedMessages).toEqual([
      {
        content: 'Previous answer with useful context.',
        role_type: 'assistant',
        role: 'assistant',
      },
      {
        content: 'What do we know about OPS-431 right now?',
        role_type: 'user',
        role: 'user',
      },
    ]);
  });

  describe('formatFactsAsContext', () => {
    it('should format facts', () => {
      const facts = [
        { uuid: '1', fact: 'Test fact', valid_at: new Date().toISOString() }
      ];

      const result = formatFactsAsContext(facts as any);

      expect(result).toContain('Test fact');
    });

    it('should handle empty facts', () => {
      expect(formatFactsAsContext([])).toBe('');
    });
  });

  describe('buildQueryFromMessages', () => {
    it('should extract last user message', () => {
      const messages = [
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'First answer' },
        { role: 'user', content: 'Second question' }
      ];

      expect(buildQueryFromMessages(messages)).toBe('Second question');
    });

    it('should return empty for no user messages', () => {
      const messages = [
        { role: 'system', content: 'System prompt' }
      ];

      expect(buildQueryFromMessages(messages)).toBe('');
    });
  });

  describe('rrfRerank', () => {
    it('should rerank results using importance and recency signals', () => {
      const results = [
        {
          uuid: 'r1',
          id: 1,
          importance: 1,
          valid_at: '2024-01-01T00:00:00.000Z'
        },
        {
          uuid: 'r2',
          id: 2,
          importance: 5,
          valid_at: '2026-01-01T00:00:00.000Z'
        },
        {
          uuid: 'r3',
          id: 3,
          importance: 3,
          valid_at: '2025-06-01T00:00:00.000Z'
        },
        {
          uuid: 'r4',
          id: 4,
          importance: 2,
          valid_at: '2023-01-01T00:00:00.000Z'
        },
        {
          uuid: 'r5',
          id: 5,
          importance: 4,
          valid_at: '2025-12-01T00:00:00.000Z'
        }
      ];

      const reranked = rrfRerank(results, 3);

      expect(reranked).toHaveLength(3);
      expect(reranked[0].id).toBe(2);
      expect(reranked.map(r => r.id)).toEqual([2, 5, 3]);
    });

    it('should handle fewer results than limit', () => {
      const results = [{ id: 1 }, { id: 2 }];

      const reranked = rrfRerank(results, 5);

      expect(reranked).toHaveLength(2);
    });
  });
});
