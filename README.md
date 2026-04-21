# Notion YouTube Agent

An AI agent built as an [Apify actor](https://docs.apify.com/platform/actors) that accepts a single natural language `task` and handles both Notion operations and YouTube research — or both together in one run.

Authentication is handled by [Scalekit](https://scalekit.com), so the actor never manages OAuth tokens directly:
- Per-user Notion accounts identified by `notionUserEmail`
- A shared YouTube connected account identified by `youtubeIdentifier`

---

## What it does

The agent interprets a free-form task and calls the appropriate tools:

**Notion-only examples:**
- `"List the 5 most recently edited pages in my Notion workspace"`
- `"Create a new page titled Meeting Notes under the workspace root"`
- `"Read the content of the page titled Product Roadmap"`

**YouTube → Notion example:**
- `"Search YouTube for clerk creators and append the top 10 channels to my Marketing Research page"`

For YouTube research, the agent:
1. Finds the target Notion page by name using `notion_data_fetch`
2. Expands the keyword into semantic search variations using an LLM
3. Searches YouTube for each variation and deduplicates channels
4. Fetches subscriber count and channel metadata
5. Scores each channel for relevance (0–10) using an LLM
6. Appends a ranked results section to the Notion page

**Output in Notion (per channel):**
- Relevance score and reasoning
- Subscriber and video count
- Channel URL
- Sample video link

---

## Prerequisites

- [Node.js](https://nodejs.org) v18+
- [Apify CLI](https://docs.apify.com/cli): `npm install -g @apify/cli`
- A [Scalekit](https://scalekit.com) environment with:
  - A Notion connection named `notion`
  - A YouTube connection named `youtube`
- An OpenAI-compatible LLM endpoint and API key (default: `https://llm.scalekit.cloud` with `claude-sonnet-4-6`)

---

## Setup

### 1. Install dependencies

```bash
git clone https://github.com/scalekit-inc/notion-youtube-agent.git
cd notion-youtube-agent
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` with your Scalekit credentials:

```env
SCALEKIT_ENV_URL=https://your-env.scalekit.com
SCALEKIT_CLIENT_ID=prd_skc_xxxxx
SCALEKIT_CLIENT_SECRET=your_secret
```

These are operator-level credentials — they authorize the actor to use Scalekit, not individual users.

### 3. Authorization at runtime

#### Notion (per-user)

The actor handles Notion authorization automatically:

1. On first run for a given `notionUserEmail`, the actor generates a magic link and writes it to `OUTPUT`
2. Open the link to authorize Notion for that user
3. The actor polls until authorization completes, then proceeds

#### YouTube (shared)

The actor now handles YouTube authorization the same way:

1. If the YouTube connected account (`youtubeIdentifier`, default `shared-youtube`) is not yet authorized, the actor generates a magic link and writes it to `OUTPUT`
2. Open the link to authorize the shared YouTube account (done once by the operator)
3. The actor polls until authorization completes, then proceeds

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

If Notion or YouTube authorization is needed, the actor writes an `AWAITING_*_AUTH` payload to `OUTPUT` with a `magicLink`. Open that link and the actor continues automatically.

---

## Input Reference

Scalekit credentials (`SCALEKIT_ENV_URL`, `SCALEKIT_CLIENT_ID`, `SCALEKIT_CLIENT_SECRET`) are set as actor environment variables, not input fields.

| Field | Required | Default | Description |
|---|---|---|---|
| `task` | Yes | — | Natural language task, e.g. `"Search YouTube for clerk creators and append the top 10 channels to my Marketing Research page"` |
| `notionUserEmail` | Yes | — | Email used as the Scalekit identifier for the user's Notion connected account |
| `llmApiKey` | Yes | — | API key for the LLM endpoint |
| `llmBaseUrl` | No | `https://llm.scalekit.cloud` | OpenAI-compatible endpoint base URL |
| `llmModel` | No | `claude-sonnet-4-6` | Model name passed to the LLM endpoint |
| `youtubeIdentifier` | No | `shared-youtube` | Scalekit identifier for the shared YouTube connected account |
| `authTimeoutSeconds` | No | `300` | How long to wait for Notion or YouTube authorization (seconds) |
| `maxIterations` | No | `10` | Max agent loop iterations |

---

## Project Structure

```
.actor/
  actor.json              # Apify actor metadata
  input_schema.json       # Apify Store UI form definition
  dataset_schema.json     # Output dataset schema
  pay_per_event.json      # Monetisation event definitions
src/
  main.js                 # Actor entry point — auth + agent
  agent.js                # Agentic loop (Notion + YouTube tools)
  llm.js                  # LLM abstraction (OpenAI-compatible)
  notionTools.js          # Notion tool definitions + Scalekit executor
  notionAuth.js           # Notion magic link + polling auth flow
  youtubeTools.js         # YouTube API calls via Scalekit
  youtubeAgentTools.js    # youtube_search_channels agent tool definition
  youtubeResearch.js      # YouTube research pipeline (expand → search → score)
  youtubeAuth.js          # YouTube magic link + polling auth flow
```

---

## Deploying to Apify

```bash
apify login
apify push
```

After pushing, set `SCALEKIT_ENV_URL`, `SCALEKIT_CLIENT_ID`, and `SCALEKIT_CLIENT_SECRET` in **Actor Settings → Environment variables** in the Apify console.

To enable Pay-Per-Event pricing, go to **Actor Settings → Monetisation**:

| Event | Default price |
|---|---|
| `task-completed` | $0.05 per run |
| `tool-call` | $0.01 per tool call |

---

## How Authentication Works

This actor uses [Scalekit Agent Auth](https://docs.scalekit.com/agent-auth/quickstart/) to connect to Notion and YouTube. Scalekit stores OAuth tokens, handles refresh, and proxies API calls.

Auth flow on each run:

1. **Notion**: looks up or creates a connected account for `notionUserEmail`. If not ACTIVE, generates a magic link, outputs it, and polls until authorized.
2. **YouTube**: looks up or creates a connected account for `youtubeIdentifier`. If not ACTIVE, generates a magic link, outputs it, and polls until authorized.
3. Once both accounts are ACTIVE, the agent runs and all API calls are proxied through Scalekit.
