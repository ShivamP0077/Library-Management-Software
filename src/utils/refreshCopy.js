/** Honest refresh labels. Success words are only for a request that actually returned. */

export const WHATSAPP_REFRESH = {
  button: 'Refresh connection',
  checking: 'Checking connection…',
  connected: 'Connected',
  disconnected: 'Disconnected',
  updated: 'Updated',
  failed: 'Failed',
};

export const SUPERADMIN_REFRESH = {
  refreshing: 'Refreshing…',
  refreshed: 'Refreshed',
  failed: 'Failed',
};

/** True session word after a status response. Connecting stays its own word. */
export function whatsappRefreshStateLabel(state) {
  if (state === 'connected') return WHATSAPP_REFRESH.connected;
  if (state === 'connecting') return 'Connecting';
  return WHATSAPP_REFRESH.disconnected;
}
