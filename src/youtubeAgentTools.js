/**
 * YouTube tool definitions and executor for the agent loop.
 *
 * Exposes a single high-level tool: youtube_search_channels
 * which runs the full research pipeline (expand → search → dedup → score).
 */

import { researchChannels } from './youtubeResearch.js';

export const YOUTUBE_TOOL_DEFINITIONS = [
  {
    name: 'youtube_search_channels',
    description:
      'Research YouTube channels about a topic. Automatically expands the keyword into multiple search queries, deduplicates results, fetches channel stats, and scores each channel for relevance. Returns a ranked list of top channels.',
    parameters: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description: 'Topic or product to research (e.g. "Clerk authentication", "Next.js auth", "Supabase tutorial")',
        },
        top_n: {
          type: 'number',
          description: 'Max channels to return (default 15)',
        },
      },
      required: ['keyword'],
    },
  },
];

/**
 * Execute a YouTube agent tool.
 *
 * @param {object} scalekitActions
 * @param {string} identifier        - Scalekit identifier for the YouTube connected account
 * @param {string} toolName
 * @param {object} toolInput
 * @param {object} client            - OpenAI-compatible LLM client (needed for expand + score steps)
 * @param {string} model
 */
export async function executeYouTubeTool(scalekitActions, identifier, toolName, toolInput, client, model) {
  if (toolName === 'youtube_search_channels') {
    const { keyword, top_n = 15 } = toolInput;
    return researchChannels({
      client,
      model,
      scalekitActions,
      youtubeIdentifier: identifier,
      keyword,
      topN: top_n,
    });
  }

  throw new Error(`Unknown YouTube tool: ${toolName}`);
}
