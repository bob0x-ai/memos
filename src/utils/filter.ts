/**
 * Check if a conversation exchange is worth remembering
 * Filters out pleasantries, acknowledgments, and trivial messages
 * 
 * @param userMsg The user's message
 * @param assistantMsg The assistant's response
 * @returns True if worth remembering, false otherwise
 */
export function isWorthRemembering(userMsg: string, assistantMsg: string): boolean {
  const combined = `${userMsg} ${assistantMsg}`.toLowerCase().trim();
  
  // Skip empty exchanges
  if (!combined) return false;
  
  // Skip very short exchanges (< 50 chars) - likely trivial
  if (combined.length < 50) return false;
  
  // Skip if it's just pleasantries and acknowledgment patterns
  const pleasantries = [
    'thanks', 'thank you', 'ok', 'okay', 'got it', 
    'sounds good', 'will do', "you're welcome", 'sure',
    'great', 'nice', 'perfect', 'awesome'
  ];
  
  // Check if the entire message is just pleasantries
  const isJustPleasantries = pleasantries.some(p => 
    combined === p || combined === `${p}.` || combined === `${p}!`
  );
  
  if (isJustPleasantries) return false;
  
  // Check if mostly pleasantries and short
  if (combined.length < 100) {
    const hasPleasantry = pleasantries.some(p => combined.includes(p));
    if (hasPleasantry) return false;
  }
  
  // Skip standalone acknowledgments (just "ok", "thanks", etc.)
  const ackPattern = /^(ok|okay|got it|thanks|thank you|sure|yes|no|yep|nope)[\.\!\?]*$/i;
  if (ackPattern.test(userMsg.trim())) return false;
  
  return true;
}

const DEFAULT_CAPTURE_MAX_MESSAGE_CHARS = 600;
const TOOL_DUMP_MIN_CLEAN_RATIO = 0.35;
const TOOL_DUMP_MIN_REMAINING_CHARS = 80;

const SUMMARY_MARKERS = [
  /##\s*Executive Memory Summary/i,
  /\bSummary ID:\s*sum_/i,
];

const TOOL_DUMP_MARKERS = [
  /Conversation info \(untrusted metadata\):/i,
  /HTTP\/1\.1/i,
  /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/[A-Za-z0-9/_-]+/i,
  /```/,
];

function getCaptureMaxMessageChars(): number {
  const raw = Number(process.env.MEMOS_CAPTURE_MAX_MESSAGE_CHARS || DEFAULT_CAPTURE_MAX_MESSAGE_CHARS);
  if (!Number.isFinite(raw) || raw < 80) {
    return DEFAULT_CAPTURE_MAX_MESSAGE_CHARS;
  }
  return Math.floor(raw);
}

function truncateForCapture(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }

  const truncated = content.slice(0, Math.max(0, maxChars - 3)).trimEnd();
  return `${truncated}...`;
}

function hasMarker(content: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(content));
}

function stripCaptureNoise(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/Conversation info \(untrusted metadata\):/gi, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function shouldSkipMessageForCapture(content: string): boolean {
  return hasMarker(content, SUMMARY_MARKERS);
}

export function sanitizeMessageForCapture(content: string): string {
  const cleaned = stripCaptureNoise(content);
  const maxChars = getCaptureMaxMessageChars();
  return truncateForCapture(cleaned, maxChars);
}

export function looksLikeToolDump(content: string, cleaned: string): boolean {
  if (!hasMarker(content, TOOL_DUMP_MARKERS)) {
    return false;
  }

  if (!cleaned) {
    return true;
  }

  if (cleaned.length < TOOL_DUMP_MIN_REMAINING_CHARS) {
    return true;
  }

  return cleaned.length / Math.max(content.length, 1) < TOOL_DUMP_MIN_CLEAN_RATIO;
}

export function prepareExchangeForCapture(
  userMsg: string,
  assistantMsg: string
): {
  userMsg: string;
  assistantMsg: string;
  skip: boolean;
  reason?: string;
} {
  if (shouldSkipMessageForCapture(userMsg) || shouldSkipMessageForCapture(assistantMsg)) {
    return {
      userMsg: '',
      assistantMsg: '',
      skip: true,
      reason: 'summary_context',
    };
  }

  const cleanedUser = sanitizeMessageForCapture(userMsg);
  const cleanedAssistant = sanitizeMessageForCapture(assistantMsg);

  if (looksLikeToolDump(userMsg, cleanedUser) || looksLikeToolDump(assistantMsg, cleanedAssistant)) {
    return {
      userMsg: '',
      assistantMsg: '',
      skip: true,
      reason: 'tool_dump',
    };
  }

  if (!cleanedUser || !cleanedAssistant) {
    return {
      userMsg: '',
      assistantMsg: '',
      skip: true,
      reason: 'empty_after_sanitize',
    };
  }

  return {
    userMsg: cleanedUser,
    assistantMsg: cleanedAssistant,
    skip: false,
  };
}

/**
 * Extract the last user and assistant messages from context
 * @param messages Array of messages
 * @returns Object with lastUser and lastAssistant messages
 */
export function getLastExchange(messages: Array<{ role: string; content: string }>): {
  lastUser: string;
  lastAssistant: string;
} {
  // Find last user message
  let lastUser = '';
  let lastAssistant = '';
  
  // Iterate backwards to find the last user-assistant exchange
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    
    if (msg.role === 'assistant' && !lastAssistant) {
      lastAssistant = msg.content;
    } else if (msg.role === 'user' && !lastUser) {
      lastUser = msg.content;
    }
    
    // If we found both, break
    if (lastUser && lastAssistant) break;
  }
  
  return { lastUser, lastAssistant };
}

/**
 * Build episode content from user and assistant messages
 * @param lastUser The last user message
 * @param lastAssistant The last assistant message
 * @returns Formatted episode content
 */
export function buildEpisodeContent(lastUser: string, lastAssistant: string): string {
  return `USER: ${lastUser}\nASSISTANT: ${lastAssistant}`.trim();
}
