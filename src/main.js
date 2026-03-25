/**
 * Apify Actor entry point for the Notion AI Agent.
 *
 * Two modes:
 *   - YouTube research (searchKeyword): searches YouTube, scores channels, appends to Notion page
 *   - Generic Notion agent (task): natural language Notion operations via LLM + tools
 */

import { Actor } from 'apify';
import { ScalekitClient } from '@scalekit-sdk/node';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { PROVIDERS, DEFAULT_MODELS } from './llm.js';
import { runAgent } from './agent.js';
import { runYouTubeNotionWorkflow } from './youtubeNotionWorkflow.js';

await Actor.init();

try {
  const input = await Actor.getInput();

  const {
    task,
    searchKeyword,
    notionPageId,
    llmProvider = PROVIDERS.ANTHROPIC,
    llmModel = '',
    llmApiKey,
    scalekitEnvUrl,
    scalekitClientId,
    scalekitClientSecret,
    notionIdentifier = 'shared-notion',
    youtubeIdentifier = 'shared-youtube',
    topN = 15,
    maxIterations = 10,
  } = input;

  if (!searchKeyword && !task) {
    throw new Error('Provide either "task" (generic agent) or "searchKeyword" (YouTube research workflow).');
  }
  if (!llmApiKey) throw new Error('Input "llmApiKey" is required.');
  if (!scalekitEnvUrl || !scalekitClientId || !scalekitClientSecret) {
    throw new Error('Scalekit credentials (scalekitEnvUrl, scalekitClientId, scalekitClientSecret) are required.');
  }

  // Build LLM client
  let client;
  if (llmProvider === PROVIDERS.ANTHROPIC) {
    client = new Anthropic({ apiKey: llmApiKey });
  } else if (llmProvider === PROVIDERS.OPENAI) {
    client = new OpenAI({ apiKey: llmApiKey });
  } else {
    throw new Error(`Unknown llmProvider: "${llmProvider}". Use "anthropic" or "openai".`);
  }

  const scalekit = new ScalekitClient(scalekitEnvUrl, scalekitClientId, scalekitClientSecret);
  const resolvedModel = llmModel || DEFAULT_MODELS[llmProvider];

  console.log(`LLM: ${llmProvider} / ${resolvedModel}`);

  if (searchKeyword) {
    // ── YouTube → Notion research workflow ──────────────────────────────────
    if (!notionPageId) throw new Error('"notionPageId" is required when using searchKeyword.');
    console.log(`Mode: YouTube research workflow`);
    console.log(`Keyword: ${searchKeyword} | Notion page: ${notionPageId}`);

    const { topChannels, totalChannelsFound, variations } = await runYouTubeNotionWorkflow({
      client,
      provider: llmProvider,
      model: resolvedModel,
      scalekitActions: scalekit.actions,
      youtubeIdentifier,
      notionIdentifier,
      notionPageId,
      keyword: searchKeyword,
      topN,
    });

    await Actor.charge({ eventName: 'task-completed', count: 1 });
    await Actor.pushData({ keyword: searchKeyword, variations, totalChannelsFound, topChannels, notionPageId });
    console.log(`\nDone. ${topChannels.length} channels written to Notion.`);
  } else {
    // ── Generic Notion agent ─────────────────────────────────────────────────
    console.log(`Mode: Generic Notion agent | Task: ${task}`);

    const { result, steps } = await runAgent({
      client,
      provider: llmProvider,
      model: resolvedModel,
      scalekitActions: scalekit.actions,
      identifier: notionIdentifier,
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

    await Actor.pushData({ task, result, steps, llmProvider, model: resolvedModel });
    console.log('\nResult:\n', result);
  }
} catch (err) {
  console.error('Actor failed:', err.message);
  await Actor.fail(err.message);
}

await Actor.exit();
