/**
 * OpenAI-compatible LLM interface (works with OpenAI, Anthropic, LiteLLM, and any OpenAI-compat endpoint).
 *
 * Normalized message types:
 *   { role: 'user',        content: string }
 *   { role: 'assistant',   content?: string, toolCalls?: ToolCall[] }
 *   { role: 'tool_result', tool_use_id: string, content: string }
 *
 * ToolCall: { id: string, name: string, input: object }
 *
 * chat() returns:
 *   { type: 'message',    content: string, assistantMessage }
 *   { type: 'tool_calls', toolCalls: ToolCall[], assistantMessage }
 */

export const DEFAULT_MODEL = 'claude-sonnet-4-6';

// ── Tool definition converters ────────────────────────────────────────────────

function toProviderTools(tools) {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

// ── Message converters ────────────────────────────────────────────────────────

function toOpenAIMessages(messages, systemPrompt) {
  const result = [];

  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt });
  }

  for (const msg of messages) {
    if (msg.role === 'tool_result') {
      result.push({
        role: 'tool',
        tool_call_id: msg.tool_use_id,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      });
    } else if (msg.role === 'assistant' && msg.toolCalls) {
      result.push({
        role: 'assistant',
        content: null,
        tool_calls: msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.input) },
        })),
      });
    } else {
      result.push({ role: msg.role, content: msg.content });
    }
  }

  return result;
}

// ── Main chat function ────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {object} opts.client        - OpenAI-compatible client instance
 * @param {string} opts.model         - model name
 * @param {string} opts.systemPrompt  - system prompt string
 * @param {object[]} opts.messages    - normalized message history
 * @param {object[]} opts.tools       - tool definitions (provider-agnostic format)
 * @returns {Promise<{type, content?, toolCalls?, assistantMessage}>}
 */
export async function chat({ client, model, systemPrompt, messages, tools }) {
  const providerTools = tools?.length ? toProviderTools(tools) : undefined;

  const response = await client.chat.completions.create({
    model,
    messages: toOpenAIMessages(messages, systemPrompt),
    ...(providerTools ? { tools: providerTools } : {}),
  });

  const msg = response.choices[0].message;

  if (msg.tool_calls?.length > 0) {
    const toolCalls = msg.tool_calls.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments),
    }));
    return {
      type: 'tool_calls',
      toolCalls,
      assistantMessage: { role: 'assistant', toolCalls },
    };
  }

  return {
    type: 'message',
    content: msg.content,
    assistantMessage: { role: 'assistant', content: msg.content },
  };
}

