import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { logger } from './utils/logger';

type ContextVisibilityState = Record<string, boolean>;

type CommandLikeContext = {
  channel: string;
  channelId?: string;
  to?: string;
  accountId?: string;
  messageThreadId?: number;
};

type HookLikeContext = {
  agentId?: string;
  sessionKey?: string;
  channelId?: string;
};

type RoutingTarget = {
  conversationKeys: string[];
  channel?: string;
  to?: string;
  accountId?: string;
  threadId?: string | number;
  sessionId?: string;
  sessionFile?: string;
};

type SessionManagerLike = {
  open: (sessionFile: string) => {
    appendCustomMessageEntry: (
      customType: string,
      content: string,
      display?: boolean,
      details?: Record<string, unknown>,
    ) => void;
  };
};

let sessionManagerLoaderOverride: (() => SessionManagerLike | null) | null = null;

function normalizeKeyPart(value: string | number | undefined | null): string {
  if (value == null) {
    return '';
  }
  return String(value).trim().toLowerCase();
}

function buildConversationKey(parts: {
  channel?: string;
  accountId?: string;
  to?: string;
  threadId?: string | number;
}): string | null {
  const channel = normalizeKeyPart(parts.channel);
  const to = normalizeKeyPart(parts.to);
  if (!channel || !to) {
    return null;
  }
  const accountId = normalizeKeyPart(parts.accountId) || 'default';
  const threadId = normalizeKeyPart(parts.threadId) || 'root';
  return `${channel}::${accountId}::${to}::${threadId}`;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))];
}

function buildConversationKeys(parts: {
  channels?: Array<string | undefined>;
  accountIds?: Array<string | undefined>;
  to?: string;
  threadIds?: Array<string | number | undefined>;
}): string[] {
  const to = normalizeKeyPart(parts.to);
  if (!to) {
    return [];
  }

  const channels = uniqueStrings(parts.channels?.map((value) => normalizeKeyPart(value)) ?? []);
  if (channels.length === 0) {
    return [];
  }

  const accountIds = uniqueStrings([
    ...(parts.accountIds?.map((value) => normalizeKeyPart(value)) ?? []),
    'default',
  ]);
  const threadIds = uniqueStrings([
    ...(parts.threadIds?.map((value) => normalizeKeyPart(value)) ?? []),
    'root',
  ]);

  const keys: string[] = [];
  for (const channel of channels) {
    for (const accountId of accountIds) {
      for (const threadId of threadIds) {
        const key = buildConversationKey({ channel, accountId, to, threadId });
        if (key) {
          keys.push(key);
        }
      }
    }
  }

  return [...new Set(keys)];
}

function getStateFilePath(api: OpenClawPluginApi): string {
  const runtime = (api as any).runtime;
  const stateDir = runtime?.state?.resolveStateDir?.();
  const baseDir =
    typeof stateDir === 'string' && stateDir.trim()
      ? stateDir
      : path.join(process.env.HOME || '.', '.openclaw', 'state');
  return path.join(baseDir, 'memos', 'context-visibility.json');
}

async function loadState(api: OpenClawPluginApi): Promise<ContextVisibilityState> {
  const statePath = getStateFilePath(api);
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw) as ContextVisibilityState;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    logger.warn('Failed to read MEMOS context visibility state', error);
    return {};
  }
}

async function saveState(api: OpenClawPluginApi, state: ContextVisibilityState): Promise<void> {
  const statePath = getStateFilePath(api);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function toThreadNumber(value: string | number | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number(value);
  }
  return undefined;
}

function resolveRoutingFromSession(api: OpenClawPluginApi, ctx: HookLikeContext): RoutingTarget {
  const runtime = (api as any).runtime;
  const storePath = runtime?.agent?.session?.resolveStorePath?.(undefined, {
    agentId: ctx.agentId,
  });
  const sessionKey = ctx.sessionKey?.trim();
  if (!storePath || !sessionKey) {
    return {
      conversationKeys: buildConversationKeys({
        channels: [ctx.channelId],
      }),
    };
  }

  try {
    const store = runtime?.agent?.session?.loadSessionStore?.(storePath);
    const entry = store?.[sessionKey];
    const channels = uniqueStrings([
      entry?.deliveryContext?.channel,
      entry?.lastChannel,
      entry?.channel,
      entry?.origin?.provider,
      ctx.channelId,
    ].map((value) => normalizeKeyPart(value)));
    const channel = channels[0];
    const to = entry?.deliveryContext?.to || entry?.lastTo || entry?.origin?.to;
    const accountId = entry?.deliveryContext?.accountId || entry?.lastAccountId || entry?.origin?.accountId;
    const threadId = entry?.lastThreadId || entry?.origin?.threadId;
    const sessionId = typeof entry?.sessionId === 'string' ? entry.sessionId : undefined;
    const sessionFile =
      sessionId && runtime?.agent?.session?.resolveSessionFilePath
        ? runtime.agent.session.resolveSessionFilePath(sessionId, entry, { agentId: ctx.agentId, storePath })
        : undefined;

    return {
      conversationKeys: buildConversationKeys({
        channels,
        to,
        accountIds: [accountId],
        threadIds: [threadId],
      }),
      channel,
      to,
      accountId,
      threadId,
      sessionId,
      sessionFile,
    };
  } catch (error) {
    logger.warn('Failed to resolve MEMOS conversation routing from session store', error);
    return {
      conversationKeys: [],
    };
  }
}

export function resolveConversationKeyFromCommand(ctx: CommandLikeContext): string | null {
  return resolveConversationKeysFromCommand(ctx)[0] ?? null;
}

export function resolveConversationKeysFromCommand(ctx: CommandLikeContext): string[] {
  return buildConversationKeys({
    channels: [ctx.channelId, ctx.channel],
    to: ctx.to,
    accountIds: [ctx.accountId],
    threadIds: [ctx.messageThreadId],
  });
}

export async function setContextVisibility(
  api: OpenClawPluginApi,
  conversationKey: string | string[],
  enabled: boolean,
): Promise<void> {
  const state = await loadState(api);
  const keys = Array.isArray(conversationKey) ? conversationKey : [conversationKey];
  for (const key of keys) {
    if (!key) {
      continue;
    }
    state[key] = enabled;
  }
  await saveState(api, state);
}

export async function isContextVisibilityEnabledForHook(
  api: OpenClawPluginApi,
  ctx: HookLikeContext,
): Promise<boolean> {
  const routing = resolveRoutingFromSession(api, ctx);
  if (routing.conversationKeys.length === 0) {
    return false;
  }
  const state = await loadState(api);
  return routing.conversationKeys.some((key) => state[key] === true);
}

function defaultLoadOpenClawSessionManager(): SessionManagerLike | null {
  try {
    const openclawEntry = require.resolve('openclaw');
    const openclawRoot = path.resolve(path.dirname(openclawEntry), '..');
    const sessionManagerModulePath = path.join(
      openclawRoot,
      'node_modules',
      '@mariozechner',
      'pi-coding-agent',
    );
    const loaded = require(sessionManagerModulePath) as {
      SessionManager?: SessionManagerLike;
    };
    return loaded.SessionManager ?? null;
  } catch (error) {
    logger.warn('Failed to load OpenClaw SessionManager for MEMOS transcript fallback', error);
    return null;
  }
}

export function loadOpenClawSessionManager(): SessionManagerLike | null {
  return sessionManagerLoaderOverride ? sessionManagerLoaderOverride() : defaultLoadOpenClawSessionManager();
}

export function setOpenClawSessionManagerLoaderForTests(
  loader: (() => SessionManagerLike | null) | null,
): void {
  sessionManagerLoaderOverride = loader;
}

export async function appendVisibleContextMonitorToTranscript(
  api: OpenClawPluginApi,
  ctx: HookLikeContext,
  text: string,
): Promise<boolean> {
  const routing = resolveRoutingFromSession(api, ctx);
  if (!routing.sessionFile) {
    logger.warn('MEMOS context monitor fallback skipped because no session transcript was resolved');
    return false;
  }

  const SessionManager = loadOpenClawSessionManager();
  if (!SessionManager) {
    return false;
  }

  try {
    const sessionManager = SessionManager.open(routing.sessionFile);
    sessionManager.appendCustomMessageEntry('MEMOS Context', text, true, {
      source: 'memos',
      kind: 'context_monitor',
      sessionId: routing.sessionId,
      channel: routing.channel,
      to: routing.to,
      accountId: routing.accountId,
      threadId: routing.threadId,
      mirror: false,
      createdAt: Date.now(),
    });
    logger.info(`MEMOS context monitor appended to session transcript ${routing.sessionFile}`);
    return true;
  } catch (error) {
    logger.warn('Failed to append MEMOS context monitor to session transcript', error);
    return false;
  }
}

export async function postVisibleContextMonitor(
  api: OpenClawPluginApi,
  ctx: HookLikeContext,
  text: string,
): Promise<boolean> {
  const routing = resolveRoutingFromSession(api, ctx);
  const runtime = (api as any).runtime;
  const cfg = runtime?.config?.loadConfig?.();
  const channel = normalizeKeyPart(routing.channel);
  if (!channel || !routing.to) {
    logger.info('MEMOS context monitor has no routable channel; falling back to session transcript');
    return appendVisibleContextMonitorToTranscript(api, ctx, text);
  }

  try {
    if (channel === 'telegram') {
      await runtime.channel.telegram.sendMessageTelegram(routing.to, text, {
        cfg,
        accountId: routing.accountId,
        messageThreadId: toThreadNumber(routing.threadId),
      });
      return true;
    }
    if (channel === 'discord') {
      await runtime.channel.discord.sendMessageDiscord(routing.to, text, {
        cfg,
        accountId: routing.accountId,
      });
      return true;
    }
    if (channel === 'slack') {
      await runtime.channel.slack.sendMessageSlack(routing.to, text, {
        cfg,
        accountId: routing.accountId,
        threadTs: typeof routing.threadId === 'string' ? routing.threadId : undefined,
      });
      return true;
    }
    if (channel === 'signal') {
      await runtime.channel.signal.sendMessageSignal(routing.to, text, { cfg });
      return true;
    }
    if (channel === 'imessage') {
      await runtime.channel.imessage.sendMessageIMessage(routing.to, text, { cfg });
      return true;
    }
    if (channel === 'whatsapp') {
      await runtime.channel.whatsapp.sendMessageWhatsApp(routing.to, text, { cfg });
      return true;
    }
    if (channel === 'line') {
      await runtime.channel.line.sendMessageLine(routing.to, text, {
        cfg,
        accountId: routing.accountId,
      });
      return true;
    }
  } catch (error) {
    logger.warn(`Failed to send MEMOS context monitor to ${channel}`, error);
    return appendVisibleContextMonitorToTranscript(api, ctx, text);
  }

  logger.info(`MEMOS context monitor not routed for unsupported channel ${channel}; falling back to session transcript`);
  return appendVisibleContextMonitorToTranscript(api, ctx, text);
}
