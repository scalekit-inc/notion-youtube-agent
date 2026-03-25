/**
 * Unified LLM interface for Claude (Anthropic) and GPT-4o (OpenAI).
 *
 * Internally we use a normalized message/response format so the agent loop
 * never touches provider-specific APIs directly.
 *
 * Normalized message types:
 *   { role: 'user',      content: string }
 *   { role: 'assistant', content?: string, toolCalls?: ToolCall[] }
 *   { role: 'tool_result', tool_use_id: string, content: string }
 *
 * ToolCall: { id: string, name: string, input: object }
 *
 * chat() returns:
 *   { type: 'message',    content: string, assistantMessage }
 *   { type: 'tool_calls', toolCalls: ToolCall[], assistantMessage }
 */

export const PROVIDERS = {
  ANTHROPIC: 'anthropic',
  OPENAI: 'openai',
};

export const DEFAULT_MODELS = {
  [PROVIDERS.ANTHROPIC]: 'claude-sonnet-4-6',
  [PROVIDERS.OPENAI]: 'gpt-4o',
};

// ── Tool definition converters ────────────────────────────────────────────────

function toProviderTools(tools, provider) {
  if (provider === PROVIDERS.ANTHROPIC) {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }
  // OpenAI
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

function toAnthropicMessages(messages) {
  const result = [];

  for (const msg of messages) {
    if (msg.role === 'tool_result') {
      // Must be grouped under a 'user' role content array
      const last = result[result.length - 1];
      if (last?.role === 'user' && Array.isArray(last.content)) {
        last.content.push({
          type: 'tool_result',
          tool_use_id: msg.tool_use_id,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        });
      } else {
        result.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.tool_use_id,
              content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
            },
          ],
        });
      }
    } else if (msg.role === 'assistant' && msg.toolCalls) {
      result.push({
        role: 'assistant',
        content: msg.toolCalls.map((tc) => ({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.input,
        })),
      });
    } else {
      result.push({ role: msg.role, content: msg.content });
    }
  }

  return result;
}

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
 * @param {object} opts.client        - Anthropic or OpenAI client instance
 * @param {string} opts.provider      - PROVIDERS.ANTHROPIC | PROVIDERS.OPENAI
 * @param {string} opts.model         - model name
 * @param {string} opts.systemPrompt  - system prompt string
 * @param {object[]} opts.messages    - normalized message history
 * @param {object[]} opts.tools       - tool definitions (provider-agnostic format)
 * @returns {Promise<{type, content?, toolCalls?, assistantMessage}>}
 */
export async function chat({ client, provider, model, systemPrompt, messages, tools }) {
  const providerTools = tools?.length ? toProviderTools(tools, provider) : undefined;

  if (provider === PROVIDERS.ANTHROPIC) {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: toAnthropicMessages(messages),
      ...(providerTools ? { tools: providerTools } : {}),
    });

    const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
    const textBlocks = response.content.filter((b) => b.type === 'text');

    if (toolUseBlocks.length > 0) {
      const toolCalls = toolUseBlocks.map((b) => ({ id: b.id, name: b.name, input: b.input }));
      return {
        type: 'tool_calls',
        toolCalls,
        assistantMessage: { role: 'assistant', toolCalls },
      };
    }

    const content = textBlocks.map((b) => b.text).join('\n');
    return {
      type: 'message',
      content,
      assistantMessage: { role: 'assistant', content },
    };
  }

  // OpenAI
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

