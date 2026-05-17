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
import { serveVerifiedAuthPage, showErrorPage, showFinalPage, startAuthServer } from './authServer.js';

await Actor.init();

try {
  const input = await Actor.getInput();

  const {
    task,
    llmModel = DEFAULT_MODEL,
    llmBaseUrl = 'https://openrouter.apify.actor/api/v1',
    maxIterations = 10,
    authTimeoutSeconds = 300,
    notionDefaultParentPageId = process.env.NOTION_DEFAULT_PARENT_PAGE_ID,
    notionDefaultDatabaseId = process.env.NOTION_DEFAULT_DATABASE_ID,
  } = input;

  const youtubeIdentifier = 'shared-youtube';
  const { userId } = Actor.getEnv();
  const notionIdentifier = userId;

  const scalekitEnvUrl = process.env.SCALEKIT_ENV_URL;
  const scalekitClientId = process.env.SCALEKIT_CLIENT_ID;
  const scalekitClientSecret = process.env.SCALEKIT_CLIENT_SECRET;
  const apifyToken = process.env.APIFY_TOKEN;
  const isApifyOpenRouter = llmBaseUrl === 'https://openrouter.apify.actor/api/v1';
  const llmApiKey = input.llmApiKey || process.env.LLM_API_KEY;

  if (!task) throw new Error('Input "task" is required.');
  if (!notionIdentifier) throw new Error('Could not determine Apify user ID — cannot identify Notion account.');
  if (isApifyOpenRouter && !apifyToken) {
    throw new Error('APIFY_TOKEN not available. Run this actor on the Apify platform or set APIFY_TOKEN for local development.');
  }
  if (!isApifyOpenRouter && !llmApiKey) {
    throw new Error('An LLM API key is required when using a custom llmBaseUrl. Set input "llmApiKey" or the LLM_API_KEY environment variable.');
  }
  if (!scalekitEnvUrl || !scalekitClientId || !scalekitClientSecret) {
    throw new Error('Scalekit credentials missing. Set SCALEKIT_ENV_URL, SCALEKIT_CLIENT_ID, SCALEKIT_CLIENT_SECRET as actor environment variables.');
  }

  const client = new OpenAI({
    baseURL: llmBaseUrl,
    ...(isApifyOpenRouter
      ? { apiKey: 'apify-openrouter', defaultHeaders: { Authorization: `Bearer ${apifyToken}` } }
      : { apiKey: llmApiKey }),
  });
  const scalekit = new ScalekitClient(scalekitEnvUrl, scalekitClientId, scalekitClientSecret);
  const { liveViewUrl } = await startAuthServer();

  console.log(`LLM: ${llmBaseUrl} / ${llmModel}`);
  console.log(`Notion identifier: ${notionIdentifier} (Apify userId)`);
  console.log(`Actor web view: ${liveViewUrl}`);
  console.log(`Task: ${task}`);

  await ensureNotionConnected(scalekit.actions, notionIdentifier, {
    timeoutMs: authTimeoutSeconds * 1000,
    userVerifyUrl: liveViewUrl,
    onMagicLink: async (link) => {
      const { liveViewUrl, markDone } = await serveVerifiedAuthPage(link, 'Notion', {
        scalekitActions: scalekit.actions,
        identifier: notionIdentifier,
      });
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
    userVerifyUrl: liveViewUrl,
    onMagicLink: async (link) => {
      const { liveViewUrl, markDone } = await serveVerifiedAuthPage(link, 'YouTube', {
        scalekitActions: scalekit.actions,
        identifier: youtubeIdentifier,
      });
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
    notionDefaultParentPageId,
    notionDefaultDatabaseId,
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
