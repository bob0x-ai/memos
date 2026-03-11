import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import {
  clearSummaryCache,
  formatSummaryAsContext,
  getSummaryDrillDown,
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
    expect(first.summaryId).toMatch(/^sum_/);
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(second.summaryId).toBe(first.summaryId);
    expect(second.summary).toBe(first.summary);
  });

  it('should format executive summary context', () => {
    const context = formatSummaryAsContext(
      'sum_test123',
      'Operations are stable with one high-priority follow-up.',
      ['fact-1', 'fact-2']
    );

    expect(context).toContain('Executive Memory Summary');
    expect(context).toContain('sum_test123');
    expect(context).toContain('fact-1');
  });

  it('should return expired status for drill-down after ttl', async () => {
    const baseNow = Date.now();
    const originalNow = Date.now;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Date as any).now = () => baseNow;

    try {
      const generated = await getOrGenerateSummary({
        query: 'Show me important learnings',
        departments: ['ops'],
        facts: [
          { uuid: 'f1', fact: 'Retry logic reduced errors', content_type: 'learning', importance: 4 },
        ],
        cacheTtlHours: 1,
        model: 'gpt-4o-mini',
      });

      // Move time forward beyond TTL
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Date as any).now = () => baseNow + 2 * 60 * 60 * 1000;

      const drillDown = getSummaryDrillDown(generated.summaryId, 5);
      expect(drillDown.status).toBe('expired');
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Date as any).now = originalNow;
    }
  });
});
