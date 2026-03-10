import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  classifyContentType,
  rateImportance,
  classifyContent,
  classifyContentHeuristic
} from '../utils/classification';

describe('Classification Utils', () => {
  describe('classifyContentHeuristic', () => {
    it('should classify decisions', () => {
      const result = classifyContentHeuristic('We decided to use Stripe for payments');
      expect(result.content_type).toBe('decision');
      expect(result.importance).toBe(4);
    });

    it('should classify preferences', () => {
      const result = classifyContentHeuristic('I prefer dark mode');
      expect(result.content_type).toBe('preference');
      expect(result.importance).toBe(2);
    });

    it('should classify warnings', () => {
      const result = classifyContentHeuristic('Warning: do not run this on production');
      expect(result.content_type).toBe('warning');
      expect(result.importance).toBe(4);
    });

    it('should classify learnings', () => {
      const result = classifyContentHeuristic('We learned that retry logic fixes this issue');
      expect(result.content_type).toBe('learning');
      expect(result.importance).toBe(3);
    });

    it('should classify contacts', () => {
      const result = classifyContentHeuristic('Kendra is the Stripe admin');
      expect(result.content_type).toBe('contact');
      expect(result.importance).toBe(4);
    });

    it('should classify SOPs', () => {
      const result = classifyContentHeuristic('To deploy, run these commands');
      expect(result.content_type).toBe('sop');
      expect(result.importance).toBe(3);
    });

    it('should default to fact', () => {
      const result = classifyContentHeuristic('The server is running on port 8080');
      expect(result.content_type).toBe('fact');
      expect(result.importance).toBe(3);
    });
  });

  describe('LLM classification', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      global.fetch = jest.fn() as any;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('should handle API errors gracefully', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      const result = await classifyContentType('test content');
      expect(result).toBe('fact');
    });

    it('should handle invalid responses', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'invalid_type' } }]
        })
      });

      const result = await classifyContentType('test content');
      expect(result).toBe('fact');
    });

    it('should classify valid content types', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'decision' } }]
        })
      });

      const result = await classifyContentType('We decided to migrate');
      expect(result).toBe('decision');
    });
  });
});
