import { Actor } from 'apify';

const ACTIVE = 1;
const STATUS_LABEL = { 0: 'UNSPECIFIED', 1: 'ACTIVE', 2: 'EXPIRED', 3: 'PENDING_AUTH' };

/**
 * @param {object} scalekitActions - scalekit.actions from ScalekitClient
 * @param {string} email           - user email, used as the Scalekit connected-account identifier
 * @param {object} opts
 * @param {number}   opts.pollIntervalMs - how often to poll for auth status (default: 5000 ms)
 * @param {number}   opts.timeoutMs      - max time to wait for authorization (default: 300 000 ms = 5 min)
 * @param {Function} opts.onMagicLink    - async callback(link: string) invoked once when the magic link is ready
 * @returns {Promise<string>} Scalekit connectedAccountId once the account is ACTIVE
 */
export async function ensureNotionConnected(scalekitActions, email, {
  pollIntervalMs = 5_000,
  timeoutMs = 300_000,
  onMagicLink = async () => {},
} = {}) {
  const resp = await scalekitActions.getOrCreateConnectedAccount({
    connectionName: 'notion',
    identifier: email,
  });
  const account = resp.connectedAccount ?? resp;

  if (account.status === ACTIVE) {
    console.log(`Notion account for "${email}" is already ACTIVE — skipping authorization.`);
    return account.id;
  }

  const statusLabel = STATUS_LABEL[account.status] ?? account.status;
  console.log(`Notion account for "${email}" is ${statusLabel}. Generating magic link...`);

  const { link } = await scalekitActions.getAuthorizationLink({
    connectionName: 'notion',
    identifier: email,
  });

  await onMagicLink(link);

  const timeoutSec = Math.round(timeoutMs / 1000);
  console.log(`Waiting up to ${timeoutSec}s for Notion authorization...`);

  // Show the magic link prominently in the Apify Console run header
  await Actor.setStatusMessage(`ACTION REQUIRED: Open magic link to authorize Notion → ${link}`);

  const deadline = Date.now() + timeoutMs;
  const logIntervalMs = 30_000; // log every 30s, not every poll
  let lastLogAt = Date.now();

  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);

    const pollResp = await scalekitActions.getOrCreateConnectedAccount({
      connectionName: 'notion',
      identifier: email,
    });
    const polledAccount = pollResp.connectedAccount ?? pollResp;

    if (polledAccount.status === ACTIVE) {
      await Actor.setStatusMessage('Notion authorized — proceeding with research.');
      console.log(`Notion account for "${email}" is now ACTIVE.`);
      return polledAccount.id;
    }

    if (Date.now() - lastLogAt >= logIntervalMs) {
      const remaining = Math.round((deadline - Date.now()) / 1000);
      const label = STATUS_LABEL[polledAccount.status] ?? polledAccount.status;
      console.log(`  Notion auth status: ${label} — ${remaining}s remaining`);
      lastLogAt = Date.now();
    }
  }

  await Actor.setStatusMessage('Timed out waiting for Notion authorization.');
  throw new Error(
    `Timed out after ${timeoutSec}s waiting for Notion authorization. ` +
    `Complete the magic link and re-run the actor.`,
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
