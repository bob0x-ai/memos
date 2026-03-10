import { ClassificationResult } from '../types';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = 'gpt-4o-mini';

const CONTENT_TYPE_PROMPT = `Classify this conversation excerpt into ONE of these categories:
- fact: Objective statement about the world (e.g., "The server is down", "Kendra works on payments")
- decision: A choice that was made or will be made (e.g., "We decided to use Stripe", "Let's migrate to AWS")
- preference: What someone likes, wants, or prefers (e.g., "I prefer dark mode", "Kendra likes Adidas shoes")
- learning: Lesson from success or failure (e.g., "We learned that retry logic fixes this", "The root cause was timeout")
- summary: Overview or summary statement
- sop: Standard procedure or how-to (e.g., "To deploy, run these commands", "The process is...")
- warning: Risk, issue, or caution (e.g., "Don't do this or it will break", "Watch out for...")
- contact: Information about a person or organization (e.g., "Kendra is the Stripe admin", "Contact sales@...")

Rules:
1. Choose the SINGLE best match
2. If multiple apply, pick the most specific one
3. Facts about decisions should be 'decision', not 'fact'
4. Facts about preferences should be 'preference', not 'fact'

Excerpt: {content}

Respond with ONLY the category name (lowercase, no quotes):`;

const IMPORTANCE_PROMPT = `Rate the importance of this information on a scale of 1-5:

1 = Trivial: Pleasantries, acknowledgments, confirmations (e.g., "thanks", "ok", "got it")
2 = Low: Minor details, tangential info (e.g., "the button is blue", "I had coffee")
3 = Medium: Useful context, background info (e.g., "we discussed this yesterday", "the API returns JSON")
4 = High: Important decisions, facts, or learnings (e.g., "we decided to migrate", "the fix was to restart")
5 = Critical: Must remember, crucial for operations (e.g., "never do X", "Kendra owns Stripe", "production password")

Rules:
- Facts about system architecture, contacts, or critical processes are 4-5
- Personal preferences are usually 2-3
- Acknowledgments and filler are 1

Excerpt: {content}

Respond with ONLY a number 1-5:`;

async function callLLM(prompt: string, content: string): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: 'You are a precise classifier. Respond only with the requested value, no explanation.' },
        { role: 'user', content: prompt.replace('{content}', content) }
      ],
      temperature: 0.1,
      max_tokens: 50
    })
  });

  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as {
    choices: [{ message: { content: string } }];
  };
  return data.choices[0].message.content.trim().toLowerCase();
}

export async function classifyContentType(content: string): Promise<string> {
  try {
    const result = await callLLM(CONTENT_TYPE_PROMPT, content);
    // Validate result
    const validTypes = ['fact', 'decision', 'preference', 'learning', 'summary', 'sop', 'warning', 'contact'];
    if (validTypes.includes(result)) {
      return result;
    }
    console.warn(`Invalid content type returned: ${result}, defaulting to 'fact'`);
    return 'fact';
  } catch (error) {
    console.error('Error classifying content type:', error);
    return 'fact'; // Default fallback
  }
}

export async function rateImportance(content: string): Promise<number> {
  try {
    const result = await callLLM(IMPORTANCE_PROMPT, content);
    const importance = parseInt(result, 10);
    if (importance >= 1 && importance <= 5) {
      return importance;
    }
    console.warn(`Invalid importance returned: ${result}, defaulting to 3`);
    return 3;
  } catch (error) {
    console.error('Error rating importance:', error);
    return 3; // Default fallback
  }
}

export async function classifyContent(content: string): Promise<ClassificationResult> {
  const [contentType, importance] = await Promise.all([
    classifyContentType(content),
    rateImportance(content)
  ]);

  return {
    content_type: contentType,
    importance
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
