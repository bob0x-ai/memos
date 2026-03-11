import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import {
  clearSummaryCache,
  formatSummaryAsContext,
  getOrGenerateSummary,
} from '../utils/summarization';

describe('Summarization Utils', () => {
  const originalApiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    clearSummaryCache();
    delete process.env.OPENAI_API_KEY;
  });

  afterAll(() => {
    if (originalApiKey) {
      process.env.OPENAI_API_KEY = originalApiKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it('should generate and then reuse in-memory cache entry', async () => {
    const facts = [
      {
        uuid: 'f1',
        fact: 'Deployment to production requires health checks.',
        importance: 4,
        content_type: 'sop',
      },
      {
        uuid: 'f2',
        fact: 'Kernel fixed a timeout issue in API gateway.',
        importance: 5,
        content_type: 'learning',
      },
    ];

    const first = await getOrGenerateSummary({
      query: 'What are the most important operational updates?',
      departments: ['ops', 'devops'],
      facts,
      cacheTtlHours: 4,
      model: 'gpt-4o-mini',
    });

    const second = await getOrGenerateSummary({
      query: 'What are the most important operational updates?',
      departments: ['ops', 'devops'],
      facts,
      cacheTtlHours: 4,
      model: 'gpt-4o-mini',
    });

    expect(first.summary.length).toBeGreaterThan(0);
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(second.summary).toBe(first.summary);
  });

  it('should format executive summary context', () => {
    const context = formatSummaryAsContext(
      'Operations are stable with one high-priority follow-up.',
      ['fact-1', 'fact-2']
    );

    expect(context).toContain('Executive Memory Summary');
    expect(context).toContain('fact-1');
  });
});
