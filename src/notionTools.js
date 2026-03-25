/**
 * Notion tool definitions (provider-agnostic) and Scalekit execution layer.
 *
 * Tool schemas match the Scalekit pre-built Notion tools exactly.
 * To add more tools, copy from the full list of 18 Notion tools in Scalekit.
 */

/** Provider-agnostic tool definitions — used to build prompts for both Claude and OpenAI */
export const NOTION_TOOL_DEFINITIONS = [
  {
    name: 'notion_data_fetch',
    description:
      'Search the Notion workspace for pages and databases by keyword. Returns a list of matching items with their IDs and titles. Use this first to find pages before reading them.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Text search query to find pages or databases',
        },
        page_size: {
          type: 'number',
          description: 'Max number of results to return (1-100, default 10)',
        },
        start_cursor: {
          type: 'string',
          description: 'Pagination cursor from a previous response',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'notion_page_get',
    description:
      'Get metadata and properties of a Notion page by its ID. Returns title, parent, and all page properties.',
    parameters: {
      type: 'object',
      properties: {
        page_id: {
          type: 'string',
          description: 'The Notion page ID (hyphenated UUID, e.g. 12345678-1234-1234-1234-123456789012)',
        },
      },
      required: ['page_id'],
    },
  },
  {
    name: 'notion_page_content_get',
    description:
      'Get the full text content and blocks of a Notion page. Use the page ID as block_id.',
    parameters: {
      type: 'object',
      properties: {
        block_id: {
          type: 'string',
          description: 'The page or block ID to retrieve children from (same as page_id)',
        },
        page_size: {
          type: 'number',
          description: 'Number of blocks to return (max 100)',
        },
        start_cursor: {
          type: 'string',
          description: 'Cursor for pagination from a previous response',
        },
      },
      required: ['block_id'],
    },
  },
  {
    name: 'notion_page_create',
    description:
      'Create a new Notion page. Use parent_page_id to create a child page, or database_id to create a database row. Do not provide both. For child pages with title: pass it in properties as {"title": {"title": [{"text": {"content": "Your Title"}}]}}. child_blocks is optional content.',
    parameters: {
      type: 'object',
      properties: {
        parent_page_id: {
          type: 'string',
          description: 'ID of the parent page (use this OR database_id, not both)',
        },
        database_id: {
          type: 'string',
          description: 'ID of the parent database (use this OR parent_page_id, not both)',
        },
        properties: {
          type: 'object',
          description:
            'Page properties. For a simple title: {"title": {"title": [{"text": {"content": "My Page"}}]}}. For database rows, key by property name.',
        },
        child_blocks: {
          type: 'array',
          description:
            'Content blocks. Example paragraph: [{"object":"block","type":"paragraph","paragraph":{"rich_text":[{"type":"text","text":{"content":"Hello"}}]}}]',
          items: { type: 'object' },
        },
      },
    },
  },
];

/**
 * Execute a Notion tool via Scalekit's proxy.
 *
 * @param {object} scalekitActions - scalekit.actions from ScalekitClient
 * @param {string} identifier - the connected account identifier (e.g. "shared-notion")
 * @param {string} toolName - one of the NOTION_TOOL_DEFINITIONS names
 * @param {object} toolInput - input matching the tool's parameter schema
 * @returns {object} tool result
 */
export async function executeNotionTool(scalekitActions, identifier, toolName, toolInput) {
  // Get the connected account ID for this identifier
  const resp = await scalekitActions.getOrCreateConnectedAccount({
    connectionName: 'notion',
    identifier,
  });

  const account = resp.connectedAccount ?? resp;

  // ConnectorStatus enum: 0=UNSPECIFIED, 1=ACTIVE, 2=EXPIRED, 3=PENDING_AUTH
  const ACTIVE = 1;
  if (account.status !== ACTIVE) {
    const statusName = { 0: 'UNSPECIFIED', 1: 'ACTIVE', 2: 'EXPIRED', 3: 'PENDING_AUTH' }[account.status] ?? account.status;
    throw new Error(
      `Notion account is not connected (status: ${statusName}). Run "npm run auth:setup" and complete the OAuth flow first.`
    );
  }

  const result = await scalekitActions.executeTool({
    toolName,
    connectedAccountId: account.id,
    toolInput,
  });

  return result;
}
