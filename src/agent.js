/**
 * Agentic loop — orchestrates LLM + Notion tool calls until the task is complete.
 */

import { chat, DEFAULT_MODELS } from './llm.js';
import { NOTION_TOOL_DEFINITIONS, executeNotionTool } from './notionTools.js';

const SYSTEM_PROMPT = `You are a helpful Notion assistant. You have access to tools that let you search, read, and create Notion pages.

Guidelines:
- To find a page, always search first using notion_data_fetch before trying to read it.
- When reading page content, use the page ID returned by the search.
- When creating a page, confirm what was created in your final response.
- Be concise and factual. If you cannot complete a task, explain why.
- Always report the final result clearly to the user.`;

/**
 * Run the agent loop for a given task.
 *
 * @param {object} opts
 * @param {object} opts.client           - LLM client (Anthropic or OpenAI)
 * @param {string} opts.provider         - 'anthropic' | 'openai'
 * @param {string} opts.model            - model name
 * @param {object} opts.scalekitActions  - scalekit.actions instance
 * @param {string} opts.identifier       - Scalekit connected account identifier
 * @param {string} opts.task             - natural language task from the user
 * @param {number} opts.maxIterations    - max agent loop iterations
 * @param {Function} opts.onStep         - optional callback(step) for logging each step
 * @returns {Promise<{result: string, steps: object[]}>}
 */
export async function runAgent({
  client,
  provider,
  model,
  scalekitActions,
  identifier,
  task,
  maxIterations = 10,
  onStep = () => {},
}) {
  const resolvedModel = model || DEFAULT_MODELS[provider];
  const messages = [{ role: 'user', content: task }];
  const steps = [];
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;

    const response = await chat({
      client,
      provider,
      model: resolvedModel,
      systemPrompt: SYSTEM_PROMPT,
      messages,
      tools: NOTION_TOOL_DEFINITIONS,
    });

    messages.push(response.assistantMessage);

    if (response.type === 'message') {
      // Agent is done
      const step = { type: 'final', content: response.content };
      steps.push(step);
      onStep(step);
      return { result: response.content, steps };
    }

    // Tool calls — execute each and feed results back
    for (const toolCall of response.toolCalls) {
      const step = {
        type: 'tool_call',
        tool: toolCall.name,
        input: toolCall.input,
      };

      onStep({ ...step, status: 'running' });

      let toolResult;
      try {
        toolResult = await executeNotionTool(
          scalekitActions,
          identifier,
          toolCall.name,
          toolCall.input
        );
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

  // Reached max iterations without a final message
  const finalMsg = `Agent reached the maximum of ${maxIterations} iterations without completing the task.`;
  return { result: finalMsg, steps };
}
