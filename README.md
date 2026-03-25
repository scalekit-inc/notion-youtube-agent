# Notion YouTube Agent

An AI agent built as an [Apify actor](https://docs.apify.com/platform/actors) that researches YouTube channels for a given keyword and surfaces the most relevant ones directly into a Notion page — with relevance scores, subscriber counts, and sample videos.

Also includes a generic Notion agent mode for natural language page operations (search, read, create).

Authentication for both YouTube and Notion is handled by [Scalekit](https://scalekit.com), so the agent never manages OAuth tokens directly.

---

## What it does

### YouTube Research Mode
Given a keyword like `"clerk creators"`:

1. Expands it into semantic search variations using an LLM
2. Searches YouTube for each variation
3. Deduplicates channels across all results
4. Fetches subscriber count and channel metadata
5. Scores each channel for relevance (0–10) using an LLM
6. Appends a ranked results section to a Notion page

**Output in Notion (per channel):**
- Relevance score and reasoning
- Subscriber and video count
- Channel URL
- Sample video link

### Generic Notion Agent Mode
Natural language operations on your Notion workspace:
- `"Find all pages about Q1 planning and list their titles"`
- `"Create a new page titled Meeting Notes under the workspace root"`
- `"Read the content of the page titled Product Roadmap"`

---

## Prerequisites

- [Node.js](https://nodejs.org) v18+
- [Apify CLI](https://docs.apify.com/cli): `npm install -g @apify/cli`
- A [Scalekit](https://scalekit.com) account with:
  - Notion connected (identifier: `shared-notion`)
  - YouTube connected (identifier: `shared-youtube`)
- An API key for [Anthropic](https://console.anthropic.com) or [OpenAI](https://platform.openai.com)

---

## Setup

### 1. Install dependencies

```bash
git clone https://github.com/scalekit-inc/notion-youtube-agent.git
cd notion-youtube-agent
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your Scalekit credentials:

```env
SCALEKIT_ENV_URL=https://your-env.scalekit.com
SCALEKIT_CLIENT_ID=prd_skc_xxxxx
SCALEKIT_CLIENT_SECRET=your_secret
NOTION_IDENTIFIER=shared-notion
```

### 3. Connect Notion and YouTube via Scalekit

Run the auth setup script once for each connection. It generates an OAuth link — open it in your browser to authorize.

```bash
# Connect Notion
npm run auth:setup

# Connect YouTube (update NOTION_IDENTIFIER=shared-youtube in .env first)
npm run auth:setup
```

Run the script a second time after authorizing to confirm `status: ACTIVE`.

---

## Local Development

Copy `INPUT.example.json` and fill in your values:

```bash
mkdir -p storage/key_value_stores/default
cp INPUT.example.json storage/key_value_stores/default/INPUT.json
# edit INPUT.json with your values
```

Run the actor:

```bash
npm start
# or
apify run
```

---

## Input Reference

| Field | Required | Description |
|---|---|---|
| `searchKeyword` | Yes (YouTube mode) | Keyword to research, e.g. `"clerk creators"` |
| `notionPageId` | Yes (YouTube mode) | ID of the Notion page to append results to |
| `task` | Yes (agent mode) | Natural language Notion task |
| `llmProvider` | No | `"anthropic"` (default) or `"openai"` |
| `llmModel` | No | Model name — leave blank for default (`claude-sonnet-4-6` / `gpt-4o`) |
| `llmApiKey` | Yes | Anthropic or OpenAI API key |
| `scalekitEnvUrl` | Yes | Your Scalekit environment URL |
| `scalekitClientId` | Yes | Scalekit OAuth client ID |
| `scalekitClientSecret` | Yes | Scalekit OAuth client secret |
| `notionIdentifier` | No | Scalekit identifier for Notion (default: `shared-notion`) |
| `youtubeIdentifier` | No | Scalekit identifier for YouTube (default: `shared-youtube`) |
| `topN` | No | Number of top channels to surface (default: `15`) |
| `maxIterations` | No | Max agent loop iterations in agent mode (default: `10`) |

---

## Project Structure

```
.actor/
  actor.json              # Apify actor metadata
  input_schema.json       # Apify Store UI form definition
  dataset_schema.json     # Output dataset schema
  pay_per_event.json      # Monetisation event definitions
src/
  main.js                 # Actor entry point — routes to workflow or agent
  agent.js                # Generic Notion agent loop
  llm.js                  # Unified LLM abstraction (Anthropic + OpenAI)
  notionTools.js          # Notion tool definitions + Scalekit executor
  youtubeTools.js         # YouTube tool executor via Scalekit
  youtubeNotionWorkflow.js # YouTube → Notion research pipeline
auth-setup/
  setup.js                # One-time OAuth setup script
```

---

## Deploying to Apify

```bash
apify login
apify push
```

After pushing, go to **Actor Settings → Monetisation** in the Apify console to enable Pay-Per-Event pricing using the events defined in `.actor/pay_per_event.json`:

| Event | Default price |
|---|---|
| `task-completed` | $0.05 per run |
| `tool-call` | $0.01 per Notion API call |

---

## How Authentication Works

This actor uses [Scalekit Agent Auth](https://docs.scalekit.com/agent-auth/quickstart/) to connect to Notion and YouTube. Scalekit stores OAuth tokens, handles refresh, and proxies API calls — so the actor never handles credentials directly.

The one-time setup flow:
1. `auth-setup/setup.js` calls Scalekit to generate an OAuth authorization link
2. You open the link, authorize in Notion/YouTube
3. Scalekit stores the token against the `identifier` you provide
4. All subsequent API calls are proxied through Scalekit automatically

---

## Switching LLM Providers

Set `llmProvider` to `"openai"` and provide an OpenAI API key — no other changes needed. The `src/llm.js` abstraction normalizes tool-calling across both providers.
