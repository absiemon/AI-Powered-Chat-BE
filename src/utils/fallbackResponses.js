
const FALLBACK_TEMPLATES = {
  greeting: [
    "Hi there! I'm having a brief connection issue right now, but I'm here. Could you say that again in a moment?",
    "Hello! Sorry, my connection just hiccupped. Mind trying that one more time?",
  ],

  query: [
    "That's a good question. I'm having trouble reaching my brain right now — could you ask again in a few seconds?",
    "I want to give you a proper answer, but I'm temporarily unable to think clearly. Please try again shortly.",
  ],

  request: [
    "I'd love to help with that. I'm hitting a temporary connection issue — please try again in a moment.",
    "Got it. I'm experiencing a brief glitch on my end. Could you resend that request shortly?",
  ],

  complaint: [
    "I hear you, and I'm sorry you're dealing with this. I'm having a connection issue right now — please try again shortly and I'll do my best to help.",
    "That sounds frustrating, and I want to help. I'm experiencing a temporary issue on my side. Could you try again in a moment?",
  ],

  feedback: [
    "Thanks for sharing that. I'm having a brief technical issue, but I'd like to respond properly — could you send that again shortly?",
    "I appreciate the feedback. I'm temporarily having trouble responding. Please try again in a moment.",
  ],

  smalltalk: [
    "Ha — I'd love to chat, but my connection is acting up. Try me again in a moment?",
    "I'm having a brief hiccup. Be right back — try again in a few seconds.",
  ],
};

/**
 * Used when intent isn't recognized or extraction itself failed.
 */
const GENERIC_FALLBACKS = [
  "I'm experiencing some temporary trouble responding. Could you try sending that again in a moment?",
  "Something's off on my end right now. Please try your message again in a few seconds.",
  "Apologies — I'm having a brief connection issue. Please try again shortly.",
];

/**
 * Optional sentiment-aware lead-in added at the front for negative sentiment.
 * Keeps the apology warm when the user is frustrated.
 */
const NEGATIVE_PREFIX = "I'm sorry — ";

/**
 * Picks a random element from an array.
 */
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Builds a contextual fallback message.
 * @param {object} [insight] - The extracted insight, if available.
 * @param {string} [insight.intent]    - e.g. 'complaint', 'query', 'greeting'.
 * @param {string} [insight.sentiment] - 'positive' | 'neutral' | 'negative'.
 * @returns {string} The fallback message.
 */
export function buildFallbackResponse(insight) {
  const intent = insight?.intent?.toLowerCase?.() || 'unknown';
  const sentiment = insight?.sentiment?.toLowerCase?.() || 'neutral';

  // Choose a templated reply when we recognize the intent,
  // otherwise fall back to a generic one.
  const pool = FALLBACK_TEMPLATES[intent] || GENERIC_FALLBACKS;
  let message = pickRandom(pool);

  // Soften the opening for negative-sentiment messages where the
  // template doesn't already include an apology.
  if (sentiment === 'negative' && !/sorry|apolog/i.test(message)) {
    message = NEGATIVE_PREFIX + message.charAt(0).toLowerCase() + message.slice(1);
  }

  return message;
}