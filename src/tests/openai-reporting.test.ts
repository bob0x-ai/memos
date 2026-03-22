import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { getMetrics, resetMetrics } from '../metrics/prometheus';
import {
  createOpenAiReportingState,
  getOpenAiReportingConfig,
  pollOpenAiReporting,
} from '../reporting/openai-reporting';

describe('OpenAI reporting poller', () => {
  const originalFetch = global.fetch;
  const originalAdminKey = process.env.OPENAI_ADMIN_KEY;
  const originalProjectId = process.env.MEMOS_OPENAI_GRAPHITI_PROJECT_ID;
  const originalEnabled = process.env.MEMOS_OPENAI_REPORTING_ENABLED;
  const originalInterval = process.env.MEMOS_OPENAI_REPORTING_INTERVAL_SECONDS;

  beforeEach(() => {
    resetMetrics();
    process.env.OPENAI_ADMIN_KEY = 'admin-test-key';
    process.env.MEMOS_OPENAI_GRAPHITI_PROJECT_ID = 'proj_graphiti_123';
    process.env.MEMOS_OPENAI_REPORTING_ENABLED = 'true';
    process.env.MEMOS_OPENAI_REPORTING_INTERVAL_SECONDS = '300';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalAdminKey === undefined) {
      delete process.env.OPENAI_ADMIN_KEY;
    } else {
      process.env.OPENAI_ADMIN_KEY = originalAdminKey;
    }
    if (originalProjectId === undefined) {
      delete process.env.MEMOS_OPENAI_GRAPHITI_PROJECT_ID;
    } else {
      process.env.MEMOS_OPENAI_GRAPHITI_PROJECT_ID = originalProjectId;
    }
    if (originalEnabled === undefined) {
      delete process.env.MEMOS_OPENAI_REPORTING_ENABLED;
    } else {
      process.env.MEMOS_OPENAI_REPORTING_ENABLED = originalEnabled;
    }
    if (originalInterval === undefined) {
      delete process.env.MEMOS_OPENAI_REPORTING_INTERVAL_SECONDS;
    } else {
      process.env.MEMOS_OPENAI_REPORTING_INTERVAL_SECONDS = originalInterval;
    }
  });

  it('should derive enabled config from reporting environment variables', () => {
    const config = getOpenAiReportingConfig();

    expect(config.enabled).toBe(true);
    expect(config.graphitiProjectId).toBe('proj_graphiti_123');
    expect(config.intervalSeconds).toBe(300);
  });

  it('should emit reporting usage and billed cost metrics without double counting overlap', async () => {
    const now = Math.floor(Date.now() / 1000);
    const usageStart = now - 120;
    const usageEnd = now - 60;
    const costStart = now - 86400;

    global.fetch = jest.fn(async (url: string) => {
      if (url.includes('/organization/usage/completions')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                start_time: usageStart,
                end_time: usageEnd,
                results: [
                  {
                    object: 'organization.usage.completions.result',
                    input_tokens: 400,
                    output_tokens: 50,
                    num_model_requests: 4,
                    project_id: 'proj_graphiti_123',
                    model: 'gpt-4o-mini',
                    api_key_id: 'key_graphiti',
                  },
                ],
              },
            ],
          }),
        } as any;
      }

      if (url.includes('/organization/usage/embeddings')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                start_time: usageStart,
                end_time: usageEnd,
                results: [
                  {
                    object: 'organization.usage.embeddings.result',
                    input_tokens: 900,
                    output_tokens: 0,
                    num_model_requests: 9,
                    project_id: 'proj_graphiti_123',
                    model: 'text-embedding-3-small',
                    api_key_id: 'key_graphiti',
                  },
                ],
              },
            ],
          }),
        } as any;
      }

      return {
        ok: true,
        json: async () => ({
          data: [
            {
              start_time: costStart,
              end_time: now,
              results: [
                {
                  object: 'organization.costs.result',
                  amount: { value: 0.12, currency: 'usd' },
                  line_item: 'embeddings, input',
                  project_id: 'proj_graphiti_123',
                },
              ],
            },
          ],
        }),
      } as any;
    }) as any;

    const config = getOpenAiReportingConfig();
    const state = createOpenAiReportingState();

    await pollOpenAiReporting(config, state);
    await pollOpenAiReporting(config, state);

    const metrics = await getMetrics();
    expect(metrics).toContain('memos_openai_usage_input_tokens_total');
    expect(metrics).toContain('use_case="extraction"');
    expect(metrics).toContain('model="gpt-4o-mini"');
    expect(metrics).toContain(' 400');
    expect(metrics).toContain('use_case="embedding"');
    expect(metrics).toContain('model="text-embedding-3-small"');
    expect(metrics).toContain(' 900');
    expect(metrics).toContain('memos_openai_billed_cost_usd_total');
    expect(metrics).toContain('line_item="embeddings, input"');
    expect(metrics).toContain(' 0.12');
  });
});
