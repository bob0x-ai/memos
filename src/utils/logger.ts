type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function getConfiguredLevel(): LogLevel {
  const raw = (process.env.MEMOS_LOG_LEVEL || 'info').toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
    return raw;
  }
  return 'info';
}

function shouldLog(level: LogLevel): boolean {
  const configured = getConfiguredLevel();
  return LEVEL_RANK[level] >= LEVEL_RANK[configured];
}

function formatMessage(level: LogLevel, message: string): string {
  return `[MEMOS] [${level.toUpperCase()}] ${message}`;
}

function log(level: LogLevel, message: string, ...args: unknown[]): void {
  if (!shouldLog(level)) {
    return;
  }

  const formatted = formatMessage(level, message);

  if (level === 'error') {
    console.error(formatted, ...args);
    return;
  }
  if (level === 'warn') {
    console.warn(formatted, ...args);
    return;
  }
  if (level === 'debug') {
    console.debug(formatted, ...args);
    return;
  }
  console.log(formatted, ...args);
}

export const logger = {
  debug: (message: string, ...args: unknown[]) => log('debug', message, ...args),
  info: (message: string, ...args: unknown[]) => log('info', message, ...args),
  warn: (message: string, ...args: unknown[]) => log('warn', message, ...args),
  error: (message: string, ...args: unknown[]) => log('error', message, ...args),
};

