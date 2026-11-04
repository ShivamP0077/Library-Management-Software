import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useWhatsappStatus, isDisconnected, navigateTo } from '../utils/whatsappStatus';

/** Red bar at the top of the app while the library's WhatsApp is logged out. */
export const WhatsAppBanner = () => {
  const s = useWhatsappStatus({ poll: 5 * 60 * 1000 });
  if (!isDisconnected(s)) return null;
  return (
    <div id="whatsapp-disconnected-banner" role="alert" className="wa-banner">
      <AlertTriangle size={16} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0 }}>WhatsApp is disconnected. Reminders and receipts can't be sent.</span>
      <button type="button" className="btn btn-sm" onClick={() => navigateTo('whatsapp', 'login')}>Reconnect</button>
    </div>
  );
};
export default WhatsAppBanner;
