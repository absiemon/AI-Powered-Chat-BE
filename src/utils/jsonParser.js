// LLMs sometimes wrap JSON in markdown code fences or include
// stray text around it. This helper extracts and parses JSON
// from a raw string in a tolerant way.

/**
 * Attempts to parse a JSON object from raw LLM output.
 * Strategy:
 *   1. Try a direct JSON.parse on the trimmed input.
 *   2. If that fails, strip markdown code fences (```json ... ```).
 *   3. If still failing, extract the substring between the first `{`
 *      and the last `}` and parse that.
 * @param {string} rawText - The raw text returned by the model.
 * @returns {object|null} Parsed object, or null if parsing failed.
 */
export function safeJsonParse(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return null;
  }

  const trimmed = rawText.trim();

  // Attempt 1: direct parse
  try {
    return JSON.parse(trimmed);
  } 
  catch {
    // fall through
  }

  const fenceStripped = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    return JSON.parse(fenceStripped);
  } 
  catch {
  }

  const firstBrace = fenceStripped.indexOf('{');
  const lastBrace = fenceStripped.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = fenceStripped.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } 
    catch {
      // give up
    }
  }
  return null;
}