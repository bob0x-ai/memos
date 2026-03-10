import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { recallHook, formatFactsAsContext, buildQueryFromMessages, rrfRerank } from '../src/hooks/recall';
import { GraphitiClient } from '../src/graphiti-client';
import { MemosConfig } from '../src/config';

jest.mock('../src/utils/config', () => ({
  getAgentConfig: jest.fn().mockReturnValue({
    access_level: 'restricted',
    department: 'test-devtest-ops',
    recall: {
      content_types: ['fact', 'learning', 'warning', 'sop'],
      max_results: 10,
      reranker: 'rrf',
      min_importance: 2
    }
  }),
  loadConfig: jest.fn().mockReturnValue({
    agents: {
      test-kernel: {
        access_level: 'restricted',
        department: 'test-devtest-ops',
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
  let mockClient: jest.Mocked<GraphitiClient>;
  let mockConfig: MemosConfig;
  let mockCtx: any;

  beforeEach(() => {
    mockClient = {
      getMemory: jest.fn().mockResolvedValue({
        facts: [
          {
            uuid: 'fact-1',
            fact: 'The server runs on port 8080',
            content_type: 'fact',
            importance: 4,
            access_level: 'restricted'
          },
          {
            uuid: 'fact-2',
            fact: 'Kendra is the Stripe admin',
            content_type: 'contact',
            importance: 5,
            access_level: 'restricted'
          },
          {
            uuid: 'fact-3',
            fact: 'We decided to use AWS',
            content_type: 'decision',
            importance: 4,
            access_level: 'confidential'  // Should be filtered for restricted agent
          }
        ]
      })
    } as any;

    mockConfig = {
      auto_recall: true,
      recall_limit: 5,
      departments: {
        test-devtest-ops: { agents: ['test-kernel'] }
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

  it('should recall and filter memories by access level', async () => {
    const result = await recallHook({}, mockCtx, mockConfig, mockClient);

    expect(result.prependSystemContext).toBeDefined();
    expect(result.prependSystemContext).toContain('port 8080');
    expect(result.prependSystemContext).toContain('Kendra');
    expect(result.prependSystemContext).not.toContain('AWS'); // Confidential, filtered
  });

  it('should skip when auto_recall is disabled', async () => {
    mockConfig.auto_recall = false;
    const result = await recallHook({}, mockCtx, mockConfig, mockClient);

    expect(mockClient.getMemory).not.toHaveBeenCalled();
    expect(result.prependSystemContext).toBeUndefined();
  });

  it('should handle empty results', async () => {
    mockClient.getMemory.mockResolvedValue({ facts: [] });
    const result = await recallHook({}, mockCtx, mockConfig, mockClient);

    expect(result.prependSystemContext).toBeUndefined();
  });

  it('should handle errors gracefully', async () => {
    mockClient.getMemory.mockRejectedValue(new Error('Graphiti error'));
    const result = await recallHook({}, mockCtx, mockConfig, mockClient);

    expect(result.prependSystemContext).toBeUndefined();
  });

  describe('formatFactsAsContext', () => {
    it('should format facts with importance', () => {
      const facts = [
        { uuid: '1', fact: 'Test fact', content_type: 'fact', importance: 4 }
      ];

      const result = formatFactsAsContext(facts);

      expect(result).toContain('Facts:');
      expect(result).toContain('⭐⭐⭐⭐');
      expect(result).toContain('Test fact');
    });

    it('should group by content type', () => {
      const facts = [
        { uuid: '1', fact: 'Fact 1', content_type: 'fact' },
        { uuid: '2', fact: 'Warning 1', content_type: 'warning' }
      ];

      const result = formatFactsAsContext(facts);

      expect(result).toContain('Facts:');
      expect(result).toContain('Warnings:');
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
      // First result should stay first (highest score)
      expect(reranked[0].id).toBe(1);
    });

    it('should handle fewer results than limit', () => {
      const results = [{ id: 1 }, { id: 2 }];

      const reranked = rrfRerank(results, 5);

      expect(reranked).toHaveLength(2);
    });
  });
});
