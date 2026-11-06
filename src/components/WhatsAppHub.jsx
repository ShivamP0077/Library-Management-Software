import React from 'react';
import { MessageCircle, FileText, BellRing, QrCode } from 'lucide-react';
import { WhatsAppMessages } from './WhatsAppMessages';
import { WhatsAppSettings } from './WhatsAppSettings';
import { WhatsAppTemplates } from './WhatsAppTemplates';
import { WhatsAppReminders } from './WhatsAppReminders';

export const WHATSAPP_PAGES = [
  { id: 'messages', label: 'Messages', icon: MessageCircle },
  { id: 'templates', label: 'Templates', icon: FileText },
  { id: 'reminders', label: 'Auto reminders', icon: BellRing },
  { id: 'login', label: 'WhatsApp Login', icon: QrCode },
];

/** WhatsApp section: Messages, Templates, Auto reminders and WhatsApp Login (QR connect). */
export const WhatsAppHub = ({ page = 'messages', setPage, canManage }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
    <div>
      <h2 style={{ fontSize: '22px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>WhatsApp</h2>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>Messages, templates, reminders and your WhatsApp login.</p>
    </div>
    <div className="wa-subtabs" role="tablist">
      {WHATSAPP_PAGES.map(p => {
        const Icon = p.icon;
        return (
          <button key={p.id} id={`wa-tab-${p.id}`} role="tab" aria-selected={page === p.id} type="button" className={page === p.id ? 'on' : ''} onClick={() => setPage(p.id)}>
            <Icon size={15} /> <span>{p.label}</span>
          </button>
        );
      })}
    </div>
    {page === 'messages' && (canManage ? <WhatsAppMessages /> : <div className="premium-card" style={{ padding: '20px', fontSize: '14px', color: 'var(--text-secondary)' }}>You don't have permission to view WhatsApp messages.</div>)}
    {page === 'templates' && (canManage ? <WhatsAppTemplates /> : <div className="premium-card" style={{ padding: '20px', fontSize: '14px', color: 'var(--text-secondary)' }}>You don't have permission to manage WhatsApp.</div>)}
    {page === 'reminders' && (canManage ? <WhatsAppReminders /> : <div className="premium-card" style={{ padding: '20px', fontSize: '14px', color: 'var(--text-secondary)' }}>You don't have permission to manage WhatsApp.</div>)}
    {page === 'login' && <WhatsAppSettings canManage={canManage} />}
  </div>
);

export default WhatsAppHub;
