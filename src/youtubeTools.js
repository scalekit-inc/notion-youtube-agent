/**
 * YouTube tool executor via Scalekit.
 */

const ACTIVE = 1; // ConnectorStatus.ACTIVE

/**
 * Get the active YouTube connected account ID.
 * Throws if not yet authorized.
 */
export async function getYouTubeAccountId(scalekitActions, identifier) {
  const resp = await scalekitActions.getOrCreateConnectedAccount({
    connectionName: 'youtube',
    identifier,
  });

  const account = resp.connectedAccount ?? resp;
  const statusName = { 0: 'UNSPECIFIED', 1: 'ACTIVE', 2: 'EXPIRED', 3: 'PENDING_AUTH' }[account.status] ?? account.status;

  if (account.status !== ACTIVE) {
    throw new Error(`YouTube account not connected (status: ${statusName}). Run auth setup for YouTube.`);
  }

  return account.id;
}

/**
 * Search YouTube for videos matching a query.
 * Returns array of { videoId, title, channelId, channelTitle, publishedAt, description }.
 */
export async function searchYouTube(scalekitActions, accountId, query, { maxResults = 15, publishedAfter } = {}) {
  const toolInput = {
    q: query,
    type: 'video',
    order: 'relevance',
    max_results: maxResults,
    part: 'snippet',
  };

  if (publishedAfter) toolInput.published_after = publishedAfter;

  const result = await scalekitActions.executeTool({
    toolName: 'youtube_search',
    connectedAccountId: accountId,
    toolInput,
  });

  const items = result?.items ?? result?.data?.items ?? [];

  return items.map((item) => ({
    videoId: item.id?.videoId,
    title: item.snippet?.title,
    channelId: item.snippet?.channelId,
    channelTitle: item.snippet?.channelTitle,
    publishedAt: item.snippet?.publishedAt,
    description: item.snippet?.description,
  })).filter((v) => v.channelId);
}

/**
 * Get channel details (subscribers, description, handle) for a list of channel IDs.
 * Returns array of { channelId, title, subscribers, videoCount, description, url }.
 * Batches in groups of 50.
 */
export async function getChannelDetails(scalekitActions, accountId, channelIds) {
  const results = [];

  for (let i = 0; i < channelIds.length; i += 50) {
    const batch = channelIds.slice(i, i + 50);

    const result = await scalekitActions.executeTool({
      toolName: 'youtube_channels_list',
      connectedAccountId: accountId,
      toolInput: {
        id: batch.join(','),
        part: 'snippet,statistics',
        max_results: 50,
      },
    });

    const items = result?.items ?? result?.data?.items ?? [];

    for (const ch of items) {
      results.push({
        channelId: ch.id,
        title: ch.snippet?.title,
        description: ch.snippet?.description,
        subscribers: parseInt(ch.statistics?.subscriberCount ?? '0', 10),
        videoCount: parseInt(ch.statistics?.videoCount ?? '0', 10),
        url: `https://youtube.com/channel/${ch.id}`,
        handle: ch.snippet?.customUrl ?? null,
      });
    }
  }

  return results;
}
