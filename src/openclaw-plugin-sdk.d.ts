declare module 'openclaw/plugin-sdk' {
  import type { IncomingMessage, ServerResponse } from 'node:http';
  import type { ReplyPayload } from 'openclaw/plugin-sdk/reply-runtime';

  export interface OpenClawPluginToolContext {
    agentId?: string;
    sessionId?: string;
    sessionKey?: string;
    requesterSenderId?: string;
  }

  export interface PluginCommandContext {
    senderId?: string;
    channel: string;
    channelId?: string;
    isAuthorizedSender: boolean;
    args?: string;
    commandBody: string;
    config: unknown;
    from?: string;
    to?: string;
    accountId?: string;
    messageThreadId?: number;
  }

  export type OpenClawPluginHttpRouteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void;
  export type OpenClawPluginHttpRouteAuth = 'gateway' | 'plugin';
  export type OpenClawPluginHttpRouteMatch = 'exact' | 'prefix';

  export interface OpenClawPluginApi {
    runtime?: any;
    on(eventName: string, handler: (event: unknown, ctx: any) => unknown): void;
    registerTool(tool: ((ctx: OpenClawPluginToolContext) => {
      name: string;
      description: string;
      parameters: unknown;
      execute: (toolCallId: string, params: any, signal?: AbortSignal) => unknown;
    }) | {
      name: string;
      description: string;
      parameters: unknown;
      execute: (toolCallId: string, params: any, signal?: AbortSignal) => unknown;
    }): void;
    registerHttpRoute(params: {
      path: string;
      auth: OpenClawPluginHttpRouteAuth;
      match?: OpenClawPluginHttpRouteMatch;
      replaceExisting?: boolean;
      handler: OpenClawPluginHttpRouteHandler;
    }): void;
    registerCommand(params: {
      name: string;
      description: string;
      acceptsArgs?: boolean;
      requireAuth?: boolean;
      handler: (ctx: PluginCommandContext) => ReplyPayload | Promise<ReplyPayload>;
    }): void;
  }
}
