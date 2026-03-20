import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockRecallHook = jest.fn<
  (event: unknown, ctx: unknown, config: unknown, client: unknown) => Promise<{
    prependSystemContext?: string;
  }>
>();
const mockEnsureBundledMemorySkillInstalled = jest.fn(async () => ({
  status: 'unchanged',
  targetPath: '/tmp/memory.md',
}));

jest.mock('../hooks/recall', () => ({
  recallHook: (event: unknown, ctx: unknown, config: unknown, client: unknown) =>
    mockRecallHook(event, ctx, config, client),
}));

jest.mock('../hooks/capture', () => ({
  captureHook: jest.fn(),
}));

jest.mock('../graphiti-client', () => ({
  GraphitiClient: jest.fn().mockImplementation(() => ({
    healthCheckDetailed: jest.fn(async () => ({ healthy: true })),
    detectCapabilities: jest.fn(async () => ({
      mode: 'fallback_summaries',
      hasCommunityEndpoints: false,
      supportsUpdateCommunitiesFlag: false,
    })),
  })),
}));

jest.mock('../utils/skill-installer', () => ({
  ensureBundledMemorySkillInstalled: () => mockEnsureBundledMemorySkillInstalled(),
}));

describe('MEMOS plugin hook wiring', () => {
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;

  beforeEach(() => {
    mockRecallHook.mockReset();
    global.setInterval = jest.fn(() => 1 as unknown as NodeJS.Timeout) as typeof setInterval;
    global.clearInterval = jest.fn() as typeof clearInterval;
  });

  afterEach(() => {
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
    jest.resetModules();
  });

  it('returns recalled context as prependSystemContext instead of prependContext', async () => {
    mockRecallHook.mockResolvedValue({
      prependSystemContext: '## Executive Memory Summary\n\nSummary ID: sum_test\n\nBlocked deploy.',
    });

    const { createPlugin } = await import('../index');
    const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown>>();
    const registerHttpRoute = jest.fn();
    const api = {
      pluginConfig: {
        auto_recall: true,
        auto_capture: false,
      },
      on: jest.fn((name: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        handlers.set(name, handler);
      }),
      registerTool: jest.fn(),
      registerHttpRoute,
    } as any;

    createPlugin().register(api);

    expect(registerHttpRoute).toHaveBeenCalledTimes(1);
    expect(registerHttpRoute).toHaveBeenCalledWith(expect.objectContaining({
      path: '/plugins/memos/metrics',
      auth: 'plugin',
      handler: expect.any(Function),
    }));

    const beforePromptBuild = handlers.get('before_prompt_build');
    expect(beforePromptBuild).toBeDefined();

    const result = await beforePromptBuild!(
      {
        messages: [
          {
            role: 'user',
            content: 'What do we know about OPS-431?',
          },
        ],
      },
      {
        agentId: 'main',
      },
    );

    expect(result).toEqual({
      prependSystemContext: '## Executive Memory Summary\n\nSummary ID: sum_test\n\nBlocked deploy.',
    });
  });
});
