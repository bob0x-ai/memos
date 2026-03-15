import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  classifyContentType,
  rateImportance,
  classifyContent,
  classifyContentHeuristic
} from '../utils/classification';
import { logger } from '../utils/logger';

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
    const originalApiKey = process.env.OPENAI_API_KEY;
    const originalLogLevel = process.env.MEMOS_LOG_LEVEL;

    beforeEach(() => {
      global.fetch = jest.fn() as any;
      process.env.OPENAI_API_KEY = 'test-api-key';
      process.env.MEMOS_LOG_LEVEL = 'warn';
    });

    afterEach(() => {
      global.fetch = originalFetch;
      if (originalApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalApiKey;
      }
      if (originalLogLevel === undefined) {
        delete process.env.MEMOS_LOG_LEVEL;
      } else {
        process.env.MEMOS_LOG_LEVEL = originalLogLevel;
      }
      jest.restoreAllMocks();
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

    it('should classify content and importance with a single API call', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"content_type":"learning","importance":4}' } }]
        })
      });

      const result = await classifyContent('We learned that retries fix transient issues');

      expect(result).toEqual({ content_type: 'learning', importance: 4 });
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should use configured temperature and max_tokens for classification requests', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"content_type":"fact","importance":3}' } }]
        })
      });

      await classifyContent('The deployment is scheduled for 22:00 UTC');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [, request] = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(request.body);
      expect(body.temperature).toBe(0.1);
      expect(body.max_tokens).toBe(100);
    });

    it('should include the API error body in the warning log before falling back', async () => {
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => '{"error":{"message":"Too many tokens in request"}}'
      });

      const result = await classifyContent('A long excerpt that triggers an API validation error');

      expect(result).toEqual({ content_type: 'fact', importance: 3 });
      expect(warnSpy).toHaveBeenCalledWith(
        'Classification API unavailable, using heuristic fallback',
        expect.objectContaining({
          message: expect.stringContaining('Too many tokens in request'),
        })
      );
    });
  });
});
