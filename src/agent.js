/**
 * Agentic loop — orchestrates LLM + Notion and YouTube tool calls until the task is complete.
 */

import { chat } from './llm.js';
import { NOTION_TOOL_DEFINITIONS, executeNotionTool } from './notionTools.js';
import { YOUTUBE_TOOL_DEFINITIONS, executeYouTubeTool } from './youtubeAgentTools.js';

const ALL_TOOL_DEFINITIONS = [...NOTION_TOOL_DEFINITIONS, ...YOUTUBE_TOOL_DEFINITIONS];

const SYSTEM_PROMPT = `You are a helpful assistant with access to Notion and YouTube tools.

Guidelines:
- To find a Notion page by name, use notion_data_fetch before reading or writing to it.
- For YouTube channel research, use youtube_search_channels — it handles keyword expansion, search, deduplication, and scoring automatically.
- To write YouTube research results to Notion, first find the target page with notion_data_fetch, then append formatted blocks with notion_page_content_append.
- Block format for notion_page_content_append: [{"type":"heading_2","text":"..."}, {"type":"bulleted_list_item","text":"..."}, {"type":"divider"}]
- Be concise and factual. Always report the final result clearly.`;

/**
 * Run the agent loop for a given task.
 *
 * @param {object} opts
 * @param {object} opts.client              - OpenAI-compatible LLM client
 * @param {string} opts.model               - model name
 * @param {object} opts.scalekitActions     - scalekit.actions instance
 * @param {string} opts.notionIdentifier    - Scalekit connected account identifier for Notion
 * @param {string} opts.youtubeIdentifier   - Scalekit connected account identifier for YouTube
 * @param {string} opts.task                - natural language task from the user
 * @param {number} opts.maxIterations       - max agent loop iterations
 * @param {Function} opts.onStep            - optional callback(step) for logging each step
 * @returns {Promise<{result: string, steps: object[]}>}
 */
export async function runAgent({
  client,
  model,
  scalekitActions,
  notionIdentifier,
  youtubeIdentifier = 'shared-youtube',
  task,
  maxIterations = 10,
  onStep = () => {},
}) {
  const messages = [{ role: 'user', content: task }];
  const steps = [];
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;

    const response = await chat({
      client,
      model,
      systemPrompt: SYSTEM_PROMPT,
      messages,
      tools: ALL_TOOL_DEFINITIONS,
    });

    messages.push(response.assistantMessage);

    if (response.type === 'message') {
      const step = { type: 'final', content: response.content };
      steps.push(step);
      onStep(step);
      return { result: response.content, steps };
    }

    for (const toolCall of response.toolCalls) {
      const step = {
        type: 'tool_call',
        tool: toolCall.name,
        input: toolCall.input,
      };

      onStep({ ...step, status: 'running' });

      let toolResult;
      try {
        if (toolCall.name.startsWith('youtube_')) {
          toolResult = await executeYouTubeTool(
            scalekitActions,
            youtubeIdentifier,
            toolCall.name,
            toolCall.input,
            client,
            model,
          );
        } else {
          toolResult = await executeNotionTool(
            scalekitActions,
            notionIdentifier,
            toolCall.name,
            toolCall.input,
          );
        }
        step.output = toolResult;
        step.status = 'success';
      } catch (err) {
        step.error = err.message;
        step.status = 'error';
        toolResult = { error: err.message };
      }

      steps.push(step);
      onStep(step);

      messages.push({
        role: 'tool_result',
        tool_use_id: toolCall.id,
        content: JSON.stringify(toolResult),
      });
    }
  }

  const finalMsg = `Agent reached the maximum of ${maxIterations} iterations without completing the task.`;
  return { result: finalMsg, steps };
}
