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
 * Notion auth is per-user: the actor accepts a notionUserEmail, creates a Scalekit
 * connected account with that email as the identifier, generates a magic link if the
 * account is not yet authorized, outputs it immediately, then polls until ACTIVE.
 */

import { Actor } from 'apify';
import { ScalekitClient } from '@scalekit-sdk/node';
import OpenAI from 'openai';
import { DEFAULT_MODEL } from './llm.js';
import { runAgent } from './agent.js';
import { ensureNotionConnected } from './notionAuth.js';
import { ensureYouTubeConnected } from './youtubeAuth.js';

await Actor.init();

try {
  const input = await Actor.getInput();

  const {
    task,
    llmModel = DEFAULT_MODEL,
    llmApiKey,
    llmBaseUrl = 'https://llm.scalekit.cloud',
    notionUserEmail,
    youtubeIdentifier = 'shared-youtube',
    maxIterations = 10,
    authTimeoutSeconds = 300,
  } = input;

  const scalekitEnvUrl = process.env.SCALEKIT_ENV_URL;
  const scalekitClientId = process.env.SCALEKIT_CLIENT_ID;
  const scalekitClientSecret = process.env.SCALEKIT_CLIENT_SECRET;

  if (!task) throw new Error('Input "task" is required.');
  if (!notionUserEmail) throw new Error('Input "notionUserEmail" is required.');
  if (!llmApiKey) throw new Error('Input "llmApiKey" is required.');
  if (!scalekitEnvUrl || !scalekitClientId || !scalekitClientSecret) {
    throw new Error('Scalekit credentials missing. Set SCALEKIT_ENV_URL, SCALEKIT_CLIENT_ID, SCALEKIT_CLIENT_SECRET as actor environment variables.');
  }

  const client = new OpenAI({ apiKey: llmApiKey, baseURL: llmBaseUrl });
  const scalekit = new ScalekitClient(scalekitEnvUrl, scalekitClientId, scalekitClientSecret);

  console.log(`LLM: ${llmBaseUrl} / ${llmModel}`);
  console.log(`Notion user: ${notionUserEmail}`);
  console.log(`Task: ${task}`);

  await ensureNotionConnected(scalekit.actions, notionUserEmail, {
    timeoutMs: authTimeoutSeconds * 1000,
    onMagicLink: async (link) => {
      console.log(`\nNotion authorization required for ${notionUserEmail}.`);
      console.log(`Magic link: ${link}\n`);
      await Actor.setValue('OUTPUT', {
        status: 'AWAITING_NOTION_AUTH',
        notionUserEmail,
        magicLink: link,
        message: `Open the magic link to authorize Notion for ${notionUserEmail}. The actor will continue automatically once you complete authorization.`,
      });
    },
  });

  await ensureYouTubeConnected(scalekit.actions, youtubeIdentifier, {
    timeoutMs: authTimeoutSeconds * 1000,
    onMagicLink: async (link) => {
      console.log(`\nYouTube authorization required for "${youtubeIdentifier}".`);
      console.log(`Magic link: ${link}\n`);
      await Actor.setValue('OUTPUT', {
        status: 'AWAITING_YOUTUBE_AUTH',
        youtubeIdentifier,
        magicLink: link,
        message: `Open the magic link to authorize YouTube for "${youtubeIdentifier}". The actor will continue automatically once you complete authorization.`,
      });
    },
  });

  const { result, steps } = await runAgent({
    client,
    model: llmModel,
    scalekitActions: scalekit.actions,
    notionIdentifier: notionUserEmail,
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

  await Actor.setValue('OUTPUT', { status: 'DONE', notionUserEmail, task, result, steps, model: llmModel });
  await Actor.pushData({ task, result, steps, model: llmModel });
  console.log('\nResult:\n', result);
} catch (err) {
  console.error('Actor failed:', err.message);
  await Actor.fail(err.message);
}

await Actor.exit();
