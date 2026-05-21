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

# Setup instruction
Step-1:- Clone the repository
```
git clone https://github.com/absiemon/AI-Powered-Chat-BE.git
```
Step-2:- Get into the root directory(parallel to src) and install the packages.
```
npm install
```
Step-3:- Create a .env file in root directory(parallel to src). Copy the env example given above and paste into it.

<img width="1262" height="293" alt="image" src="https://github.com/user-attachments/assets/b83cc700-c51d-4118-a695-1660361dd50f" />
Note:- If you have only one gemini key you can use the same key in both variable GEMINI_API_KEYS and GEMINI_API_KEY


Step-4:- Start the server 
```
npm run dev
```


