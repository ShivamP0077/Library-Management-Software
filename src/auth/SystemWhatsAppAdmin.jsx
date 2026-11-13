import React, { useCallback } from 'react';
import { api } from '../utils/api';
import { WhatsAppLinkPanel } from '../components/WhatsAppLinkPanel';

const NOTE = 'Sign-up codes and My Library OS messages are sent from this number.';

export function SystemWhatsAppAdmin() {
  const fetchStatus = useCallback(() => api.systemWhatsappStatus(), []);
  const connect = useCallback(() => api.systemWhatsappConnect(), []);
  const disconnect = useCallback(() => api.systemWhatsappDisconnect(), []);
  return (
    <WhatsAppLinkPanel
      fetchStatus={fetchStatus}
      connect={connect}
      disconnect={disconnect}
      title="WhatsApp"
      subtitle={NOTE}
      connectedHint={NOTE}
      disconnectedHint={NOTE}
      connectLabel="Connect WhatsApp"
      disconnectLabel="Disconnect"
      disconnectConfirm="Disconnect this WhatsApp number? Sign-up codes will not be sent until you connect again."
      steps={[
        'Open WhatsApp on the phone for this number',
        'Tap Linked devices',
        'Tap Link a device',
        'Scan this QR code',
      ]}
    />
  );
}
