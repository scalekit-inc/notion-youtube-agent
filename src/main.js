/**
 * Apify Actor entry point for the Notion + YouTube AI Agent.
 *
 * Single mode: natural language "task" handled by an agent with access to both
 * Notion tools (search, read, create, append) and a YouTube research tool.
 *
 * Example tasks:
 *   "List the 5 most recently edited pages in my Notion workspace"
 *   "Search YouTube for clerk creators and append the top 10 to my Marketing Research page"
 *
 * Notion auth is per-user: identifier derived from Apify userId, generates a magic
 * link if the account is not yet authorized, outputs it immediately, then polls until ACTIVE.
 */

import { Actor } from 'apify';
import { ScalekitClient } from '@scalekit-sdk/node';
import OpenAI from 'openai';
import { DEFAULT_MODEL } from './llm.js';
import { runAgent } from './agent.js';
import { ensureNotionConnected } from './notionAuth.js';
import { ensureYouTubeConnected } from './youtubeAuth.js';
import { serveAuthPage, showErrorPage, showFinalPage, startAuthServer } from './authServer.js';

await Actor.init();

try {
  const input = await Actor.getInput();

  const {
    task,
    llmModel = DEFAULT_MODEL,
    llmApiKey,
    llmBaseUrl = 'https://llm.scalekit.cloud',
    maxIterations = 10,
    authTimeoutSeconds = 300,
  } = input;

  const youtubeIdentifier = 'shared-youtube';
  const { userId } = Actor.getEnv();
  const notionIdentifier = userId;

  const scalekitEnvUrl = process.env.SCALEKIT_ENV_URL;
  const scalekitClientId = process.env.SCALEKIT_CLIENT_ID;
  const scalekitClientSecret = process.env.SCALEKIT_CLIENT_SECRET;

  if (!task) throw new Error('Input "task" is required.');
  if (!notionIdentifier) throw new Error('Could not determine Apify user ID — cannot identify Notion account.');
  if (!llmApiKey) throw new Error('Input "llmApiKey" is required.');
  if (!scalekitEnvUrl || !scalekitClientId || !scalekitClientSecret) {
    throw new Error('Scalekit credentials missing. Set SCALEKIT_ENV_URL, SCALEKIT_CLIENT_ID, SCALEKIT_CLIENT_SECRET as actor environment variables.');
  }

  const client = new OpenAI({ apiKey: llmApiKey, baseURL: llmBaseUrl });
  const scalekit = new ScalekitClient(scalekitEnvUrl, scalekitClientId, scalekitClientSecret);
  const { liveViewUrl } = await startAuthServer();

  console.log(`LLM: ${llmBaseUrl} / ${llmModel}`);
  console.log(`Notion identifier: ${notionIdentifier} (Apify userId)`);
  console.log(`Actor web view: ${liveViewUrl}`);
  console.log(`Task: ${task}`);

  await ensureNotionConnected(scalekit.actions, notionIdentifier, {
    timeoutMs: authTimeoutSeconds * 1000,
    onMagicLink: async (link) => {
      const { liveViewUrl, markDone } = await serveAuthPage(link, 'Notion');
      console.log(`\nNotion auth required. Open: ${liveViewUrl}\n`);
      await Actor.setValue('OUTPUT', {
        status: 'AWAITING_NOTION_AUTH',
        authPageUrl: liveViewUrl,
        magicLink: link,
        message: 'Open the View output tab to authorize Notion.',
      });
      await Actor.setStatusMessage(`ACTION REQUIRED: Authorize Notion → ${liveViewUrl}`);
      return markDone;
    },
  });

  await ensureYouTubeConnected(scalekit.actions, youtubeIdentifier, {
    timeoutMs: authTimeoutSeconds * 1000,
    onMagicLink: async (link) => {
      const { liveViewUrl, markDone } = await serveAuthPage(link, 'YouTube');
      console.log(`\nYouTube auth required. Open: ${liveViewUrl}\n`);
      await Actor.setValue('OUTPUT', {
        status: 'AWAITING_YOUTUBE_AUTH',
        authPageUrl: liveViewUrl,
        magicLink: link,
        message: 'Open the View output tab to authorize YouTube.',
      });
      await Actor.setStatusMessage(`ACTION REQUIRED: Authorize YouTube → ${liveViewUrl}`);
      return markDone;
    },
  });

  const { result, steps } = await runAgent({
    client,
    model: llmModel,
    scalekitActions: scalekit.actions,
    notionIdentifier,
    youtubeIdentifier,
    task,
    maxIterations,
    onStep: async (step) => {
      if (step.type === 'tool_call') {
        console.log(`[tool] ${step.tool} → ${step.status}`);
        if (step.error) console.error(`  Error: ${step.error}`);
        if (step.status === 'success') {
          await Actor.charge({ eventName: 'tool-call', count: 1 });
        }
      } else if (step.type === 'final') {
        console.log('[done] Agent finished.');
        await Actor.charge({ eventName: 'task-completed', count: 1 });
      }
    },
  });

  await showFinalPage(result);
  await Actor.setValue('OUTPUT', { status: 'DONE', notionIdentifier, task, result, steps, model: llmModel });
  await Actor.pushData({ task, result, steps, model: llmModel });
  console.log('\nResult:\n', result);
} catch (err) {
  console.error('Actor failed:', err.message);
  await showErrorPage(err.message);
  await Actor.fail(err.message);
}

await Actor.exit();
