import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import os from 'node:os';
import path from 'node:path';

import {
  appendVisibleContextMonitorToTranscript,
  isContextVisibilityEnabledForHook,
  postVisibleContextMonitor,
  resolveConversationKeysFromCommand,
  setOpenClawSessionManagerLoaderForTests,
  setContextVisibility,
} from '../context-visibility';

describe('context visibility', () => {
  const stateDir = path.join(os.tmpdir(), `memos-context-visibility-${Date.now()}`);

  beforeEach(() => {
    jest.restoreAllMocks();
    setOpenClawSessionManagerLoaderForTests(null);
  });

  afterEach(() => {
    setOpenClawSessionManagerLoaderForTests(null);
    jest.restoreAllMocks();
  });

  it('matches enabled state across command and hook routing aliases', async () => {
    const api = {
      runtime: {
        state: {
          resolveStateDir: () => stateDir,
        },
        agent: {
          session: {
            resolveStorePath: () => '/tmp/memos-session-store.json',
            loadSessionStore: () => ({
              'sess:1': {
                sessionId: 'session-1',
                deliveryContext: {
                  channel: 'telegram',
                  to: '12345',
                  accountId: 'acct-1',
                },
              },
            }),
            resolveSessionFilePath: () => '/tmp/session-1.jsonl',
          },
        },
      },
    } as any;

    await setContextVisibility(
      api,
      resolveConversationKeysFromCommand({
        channel: 'telegram',
        channelId: 'telegram-bot',
        to: '12345',
        accountId: 'acct-1',
      }),
      true,
    );

    await expect(
      isContextVisibilityEnabledForHook(api, {
        agentId: 'main',
        sessionKey: 'sess:1',
      }),
    ).resolves.toBe(true);
  });

  it('falls back to the session transcript when no routable channel is available', async () => {
    const appendCustomMessageEntry = jest.fn();
    const open = jest.fn(() => ({
      appendCustomMessageEntry,
    }));
    setOpenClawSessionManagerLoaderForTests(() => ({
      open,
    }));

    const api = {
      runtime: {
        state: {
          resolveStateDir: () => stateDir,
        },
        config: {
          loadConfig: () => ({}),
        },
        agent: {
          session: {
            resolveStorePath: () => '/tmp/memos-session-store.json',
            loadSessionStore: () => ({
              'sess:2': {
                sessionId: 'session-2',
                sessionFile: '/tmp/session-2.jsonl',
              },
            }),
            resolveSessionFilePath: () => '/tmp/session-2.jsonl',
          },
        },
      },
    } as any;

    await expect(
      postVisibleContextMonitor(api, { agentId: 'main', sessionKey: 'sess:2' }, 'MEMOS Context\n\nNo relevant context found.'),
    ).resolves.toBe(true);

    expect(open).toHaveBeenCalledWith('/tmp/session-2.jsonl');
    expect(appendCustomMessageEntry).toHaveBeenCalledWith(
      'MEMOS Context',
      'MEMOS Context\n\nNo relevant context found.',
      true,
      expect.objectContaining({
        source: 'memos',
        kind: 'context_monitor',
        sessionId: 'session-2',
        mirror: false,
      }),
    );
  });

  it('can append directly to the session transcript fallback', async () => {
    const appendCustomMessageEntry = jest.fn();
    const open = jest.fn(() => ({
      appendCustomMessageEntry,
    }));
    setOpenClawSessionManagerLoaderForTests(() => ({
      open,
    }));

    const api = {
      runtime: {
        agent: {
          session: {
            resolveStorePath: () => '/tmp/memos-session-store.json',
            loadSessionStore: () => ({
              'sess:3': {
                sessionId: 'session-3',
                deliveryContext: {
                  channel: 'internal',
                  to: 'session',
                },
              },
            }),
            resolveSessionFilePath: () => '/tmp/session-3.jsonl',
          },
        },
      },
    } as any;

    await expect(
      appendVisibleContextMonitorToTranscript(api, { agentId: 'main', sessionKey: 'sess:3' }, 'MEMOS Context\n\nInjected context'),
    ).resolves.toBe(true);

    expect(appendCustomMessageEntry).toHaveBeenCalledTimes(1);
  });
});
