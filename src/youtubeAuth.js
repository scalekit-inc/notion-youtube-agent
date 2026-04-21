import { Actor } from 'apify';

const ACTIVE = 1;
const STATUS_LABEL = { 0: 'UNSPECIFIED', 1: 'ACTIVE', 2: 'EXPIRED', 3: 'PENDING_AUTH' };

/**
 * @param {object} scalekitActions
 * @param {string} identifier      - connected account identifier (e.g. 'shared-youtube')
 * @param {object} opts
 * @param {number}   opts.pollIntervalMs
 * @param {number}   opts.timeoutMs
 * @param {Function} opts.onMagicLink
 * @returns {Promise<string>} connectedAccountId once ACTIVE
 */
export async function ensureYouTubeConnected(scalekitActions, identifier, {
  pollIntervalMs = 5_000,
  timeoutMs = 300_000,
  onMagicLink = async () => {},
} = {}) {
  const resp = await scalekitActions.getOrCreateConnectedAccount({
    connectionName: 'youtube',
    identifier,
  });
  const account = resp.connectedAccount ?? resp;

  if (account.status === ACTIVE) {
    console.log(`YouTube account "${identifier}" is already ACTIVE — skipping authorization.`);
    return account.id;
  }

  const statusLabel = STATUS_LABEL[account.status] ?? account.status;
  console.log(`YouTube account "${identifier}" is ${statusLabel}. Generating magic link...`);

  const { link } = await scalekitActions.getAuthorizationLink({
    connectionName: 'youtube',
    identifier,
  });

  await onMagicLink(link);

  const timeoutSec = Math.round(timeoutMs / 1000);
  console.log(`Waiting up to ${timeoutSec}s for YouTube authorization...`);
  await Actor.setStatusMessage(`ACTION REQUIRED: Open magic link to authorize YouTube → ${link}`);

  const deadline = Date.now() + timeoutMs;
  const logIntervalMs = 30_000;
  let lastLogAt = Date.now();

  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);

    const pollResp = await scalekitActions.getOrCreateConnectedAccount({
      connectionName: 'youtube',
      identifier,
    });
    const polledAccount = pollResp.connectedAccount ?? pollResp;

    if (polledAccount.status === ACTIVE) {
      await Actor.setStatusMessage('YouTube authorized — proceeding.');
      console.log(`YouTube account "${identifier}" is now ACTIVE.`);
      return polledAccount.id;
    }

    if (Date.now() - lastLogAt >= logIntervalMs) {
      const remaining = Math.round((deadline - Date.now()) / 1000);
      const label = STATUS_LABEL[polledAccount.status] ?? polledAccount.status;
      console.log(`  YouTube auth status: ${label} — ${remaining}s remaining`);
      lastLogAt = Date.now();
    }
  }

  await Actor.setStatusMessage('Timed out waiting for YouTube authorization.');
  throw new Error(
    `Timed out after ${timeoutSec}s waiting for YouTube authorization. ` +
    `Complete the magic link and re-run the actor.`,
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
