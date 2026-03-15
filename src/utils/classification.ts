import { ClassificationResult } from '../types';
import { logger } from './logger';
import { DEFAULT_LLM_PROMPTS, loadConfig } from './config';

const DEFAULT_MODEL = 'gpt-4o-mini';
const VALID_CONTENT_TYPES = ['fact', 'decision', 'preference', 'learning', 'summary', 'sop', 'warning', 'contact'];

function getClassificationSettings(): {
  model: string;
  systemPrompt: string;
  userTemplate: string;
  temperature: number;
  maxTokens: number;
} {
  try {
    const runtimeConfig = loadConfig();
    const configuredTemperature =
      typeof runtimeConfig.llm?.temperature === 'number' ? runtimeConfig.llm.temperature : 0;
    const configuredMaxTokens =
      typeof runtimeConfig.llm?.max_tokens === 'number' ? runtimeConfig.llm.max_tokens : 100;
    return {
      model: runtimeConfig.llm?.model || DEFAULT_MODEL,
      systemPrompt:
        runtimeConfig.llm?.prompts?.classification_system ||
        DEFAULT_LLM_PROMPTS.classification_system,
      userTemplate:
        runtimeConfig.llm?.prompts?.classification_user_template ||
        DEFAULT_LLM_PROMPTS.classification_user_template,
      temperature: Number.isFinite(configuredTemperature) ? configuredTemperature : 0,
      maxTokens:
        Number.isFinite(configuredMaxTokens) && configuredMaxTokens > 0
          ? Math.floor(configuredMaxTokens)
          : 100,
    };
  } catch {
    return {
      model: DEFAULT_MODEL,
      systemPrompt: DEFAULT_LLM_PROMPTS.classification_system,
      userTemplate: DEFAULT_LLM_PROMPTS.classification_user_template,
      temperature: 0,
      maxTokens: 100,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function getCodeBlockJson(raw: string): string | null {
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return match?.[1] || null;
}

function parseClassificationResponse(raw: string): ClassificationResult | null {
  const trimmed = raw.trim();
  const lowered = trimmed.toLowerCase();

  // Backward compatibility: handle legacy single-token responses.
  if (VALID_CONTENT_TYPES.includes(lowered)) {
    return { content_type: lowered, importance: 3 };
  }

  const parsedImportance = parseInt(lowered, 10);
  if (parsedImportance >= 1 && parsedImportance <= 5) {
    return { content_type: 'fact', importance: parsedImportance };
  }

  const candidates: string[] = [trimmed];
  const codeBlock = getCodeBlockJson(trimmed);
  if (codeBlock) {
    candidates.push(codeBlock);
  }
  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    candidates.push(objectMatch[0]);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const contentType = String(parsed.content_type ?? parsed.type ?? '').toLowerCase();
      const importance = Number(parsed.importance ?? parsed.score);
      if (VALID_CONTENT_TYPES.includes(contentType) && importance >= 1 && importance <= 5) {
        return {
          content_type: contentType,
          importance: Math.round(importance),
        };
      }
    } catch {
      // Ignore parse errors and keep trying fallback shapes.
    }
  }

  return null;
}

async function callLLM(
  systemPrompt: string,
  userTemplate: string,
  model: string,
  content: string,
  options: { temperature: number; maxTokens: number }
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const timeoutMs = Number(process.env.MEMOS_CLASSIFICATION_TIMEOUT_MS || 8000);
  const retries = Number(process.env.MEMOS_CLASSIFICATION_RETRIES || 2);

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: systemPrompt,
            },
            { role: 'user', content: userTemplate.replace('{content}', content) }
          ],
          temperature: options.temperature,
          max_tokens: options.maxTokens
        })
      });

      if (!response.ok) {
        const errorBody = (await response.text()).trim();
        if (isRetryableStatus(response.status) && attempt < retries) {
          const delayMs = 400 * Math.pow(2, attempt);
          await sleep(delayMs);
          continue;
        }
        const detail = errorBody ? ` - ${errorBody.slice(0, 1000)}` : '';
        throw new Error(`LLM API error: ${response.status} ${response.statusText}${detail}`);
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const output = data.choices?.[0]?.message?.content?.trim();
      if (!output) {
        throw new Error('LLM API returned empty classification output');
      }
      return output;
    } catch (error) {
      lastError = error;
      const isAbort = error instanceof Error && error.name === 'AbortError';
      if (attempt < retries && isAbort) {
        const delayMs = 400 * Math.pow(2, attempt);
        await sleep(delayMs);
        continue;
      }
      if (attempt < retries && !(error instanceof Error && /LLM API error: 4\d\d/.test(error.message))) {
        const delayMs = 400 * Math.pow(2, attempt);
        await sleep(delayMs);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Classification failed');
}

export async function classifyContentType(content: string): Promise<string> {
  const result = await classifyContent(content);
  return result.content_type;
}

export async function rateImportance(content: string): Promise<number> {
  const result = await classifyContent(content);
  return result.importance;
}

export async function classifyContent(content: string): Promise<ClassificationResult> {
  if (!process.env.OPENAI_API_KEY) {
    return classifyContentHeuristic(content);
  }

  try {
    const settings = getClassificationSettings();
    const raw = await callLLM(
      settings.systemPrompt,
      settings.userTemplate,
      settings.model,
      content,
      {
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
      }
    );
    const parsed = parseClassificationResponse(raw);
    if (!parsed) {
      throw new Error(`Invalid classification output: ${raw}`);
    }
    return parsed;
  } catch (error) {
    logger.warn('Classification API unavailable, using heuristic fallback', error);
    return classifyContentHeuristic(content);
  };
}

// Simple heuristic fallback for when LLM is unavailable
export function classifyContentHeuristic(content: string): ClassificationResult {
  const contentLower = content.toLowerCase();
  
  // Check for decision patterns
  if (/\b(decided|decision|will|going to|plan to)\b/.test(contentLower)) {
    return { content_type: 'decision', importance: 4 };
  }
  
  // Check for preference patterns
  if (/\b(prefer|like|want|dislike|hate)\b/.test(contentLower)) {
    return { content_type: 'preference', importance: 2 };
  }
  
  // Check for warning patterns
  if (/\b(warning|don't|do not|never|be careful|watch out)\b/.test(contentLower)) {
    return { content_type: 'warning', importance: 4 };
  }
  
  // Check for learning patterns
  if (/\b(learned|lesson|realized|found out|discovered)\b/.test(contentLower)) {
    return { content_type: 'learning', importance: 3 };
  }
  
  // Check for contact patterns
  if (/\b(is the|contact|email|phone|reach)\s+\w+\s+(admin|owner|lead)\b/.test(contentLower) ||
      /\b(is the|contact|email|phone|reach)\s+(admin|owner|lead)\b/.test(contentLower)) {
    return { content_type: 'contact', importance: 4 };
  }
  
  // Check for SOP patterns
  if (/\b(how to|steps|process|procedure|deploy|install|configure)\b/.test(contentLower)) {
    return { content_type: 'sop', importance: 3 };
  }
  
  // Default to fact
  return { content_type: 'fact', importance: 3 };
}
