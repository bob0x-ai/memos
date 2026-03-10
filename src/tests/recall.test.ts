import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { recallHook, formatFactsAsContext, buildQueryFromMessages, rrfRerank } from '../hooks/recall';
import { GraphitiClient } from '../graphiti-client';
import { MemosConfig } from '../config';

jest.mock('../utils/config', () => ({
  getAgentConfig: jest.fn().mockReturnValue({
    access_level: 'restricted',
    department: 'test-devops',
    recall: {
      content_types: ['fact', 'learning', 'warning', 'sop'],
      max_results: 10,
      reranker: 'rrf',
      min_importance: 2
    }
  }),
  loadConfig: jest.fn().mockReturnValue({
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

  beforeEach(() => {
    mockClient = {
      getMemory: jest.fn().mockResolvedValue({
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
      })
    };

    mockConfig = {
      auto_recall: true,
      recall_limit: 5,
      departments: {
        'test-devops': { agents: ['test-kernel'] }
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

  it('should recall memories', async () => {
    const result = await recallHook({}, mockCtx, mockConfig, mockClient);

    expect(result.prependSystemContext).toBeDefined();
    expect(result.prependSystemContext).toContain('port 8080');
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
    it('should rerank results', () => {
      const results = [
        { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }
      ];

      const reranked = rrfRerank(results, 3);

      expect(reranked).toHaveLength(3);
      expect(reranked[0].id).toBe(1);
    });

    it('should handle fewer results than limit', () => {
      const results = [{ id: 1 }, { id: 2 }];

      const reranked = rrfRerank(results, 5);

      expect(reranked).toHaveLength(2);
    });
  });
});
