import { describe, it, expect, beforeAll } from '@jest/globals';
import { classifyContent } from '../utils/classification';
import { clearSummaryCache, getOrGenerateSummary } from '../utils/summarization';

const hasRealApiKey =
  Boolean(process.env.OPENAI_API_KEY) &&
  process.env.OPENAI_API_KEY !== 'test-api-key';
const runLLMIntegration =
  process.env.MEMOS_RUN_LLM_TESTS === 'true' && hasRealApiKey;

const describeLLM = runLLMIntegration ? describe : describe.skip;

describeLLM('LLM Integration', () => {
  beforeAll(() => {
    process.env.MEMOS_ENABLE_LLM_IN_TESTS = 'true';
    clearSummaryCache();
  });

  it(
    'classifyContent should call live LLM and return structured classification',
    async () => {
      const result = await classifyContent(
        'We decided to postpone launch by one week due to unresolved production incidents.'
      );

      expect(result.content_type).toBeTruthy();
      expect(result.importance).toBeGreaterThanOrEqual(1);
      expect(result.importance).toBeLessThanOrEqual(5);
    },
    45000
  );

  it(
    'getOrGenerateSummary should call live LLM then hit in-memory cache',
    async () => {
      const facts = [
        {
          uuid: 'live-f1',
          fact: 'Production deploy had three retries before success.',
          content_type: 'learning',
          importance: 4,
          _department: 'ops',
        },
        {
          uuid: 'live-f2',
          fact: 'Management requested a rollback checklist for critical releases.',
          content_type: 'decision',
          importance: 5,
          _department: 'ops',
        },
      ];

      const first = await getOrGenerateSummary({
        query: 'What should management know about deployment stability?',
        departments: ['ops'],
        facts,
        cacheTtlHours: 4,
        model: 'gpt-4o-mini',
      });

      const second = await getOrGenerateSummary({
        query: 'What should management know about deployment stability?',
        departments: ['ops'],
        facts,
        cacheTtlHours: 4,
        model: 'gpt-4o-mini',
      });

      expect(first.summary.length).toBeGreaterThan(0);
      expect(first.summaryId).toMatch(/^sum_/);
      expect(first.cacheHit).toBe(false);
      expect(second.cacheHit).toBe(true);
      expect(second.summaryId).toBe(first.summaryId);
      expect(second.summary).toBe(first.summary);
    },
    60000
  );
});
