# Intro 
The backend takes a user message, sends it to an AI model to get a reply, and at the same time runs a second AI call to
figure out the message's intent (like "complaint" or "greeting") and sentiment (positive, neutral, or negative). Both come
back in a single response. Chat history is kept in memory, grouped by a session ID, so the AI has context for follow-up
questions.
# Tech stack
Runtime - Node.js with ES Modules
Framework - Express
AI provider - Google Gemini (gemini-2.5-flash) via @google/genai SDK
Logging - Pino + pino-http (pretty in dev, JSON in production)
Security - Helmet for headers, express-rate-limit for per-IP limits, CORS
Storage - How the code is organised
In-memory Map (no database — fits the assignment scope)

# Env 
```
PORT = 8000

GEMINI_API_KEYS=key1,key2,key3,key4,..
GEMINI_API_KEY=key1
GEMINI_MODEL=gemini-2.5-flash-lite
GEMINI_TIMEOUT_MS=20000
GEMINI_KEY_COOLDOWN_MS=60000

```
