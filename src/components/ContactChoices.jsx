import React, { useState } from 'react';
import { Mail, MessageCircle, Ticket } from 'lucide-react';
import { SUPPORT_EMAIL, SUPPORT_WHATSAPP, whatsappHref } from '../utils/support';
import { PublicTicketForm } from './PublicTicketForm';

/** Email, dedicated-support WhatsApp, and a public ticket. No owner phone. */
export function ContactChoices({ showPublicTicket = true, compact = false }) {
  const [open, setOpen] = useState(false);
  const chat = SUPPORT_WHATSAPP && whatsappHref(SUPPORT_WHATSAPP);
  return (
    <section className="os-card os-contact" aria-label="Contact Us">
      <a className="os-row" href={`mailto:${SUPPORT_EMAIL}`}>
        <span className="os-icon" style={{ background: '#dbeafe' }}><Mail size={18} color="#1c1917" /></span>
        <span className="os-row-label">Email</span>
        <span className="os-row-value">{SUPPORT_EMAIL}</span>
      </a>
      {chat ? (
        <a className="os-row" href={chat} target="_blank" rel="noreferrer">
          <span className="os-icon" style={{ background: '#d1fae5' }}><MessageCircle size={18} color="#1c1917" /></span>
          <span className="os-row-label">Chat on WhatsApp</span>
          <span className="os-row-value">Chat</span>
        </a>
      ) : (
        <div className="os-row" style={{ cursor: 'default' }}>
          <span className="os-icon" style={{ background: '#d1fae5' }}><MessageCircle size={18} color="#1c1917" /></span>
          <span className="os-row-label">Chat on WhatsApp</span>
          <span className="os-row-value">Unavailable</span>
        </div>
      )}
      {showPublicTicket && (
        <button type="button" className="os-row" onClick={() => setOpen(v => !v)}>
          <span className="os-icon" style={{ background: '#fef3c7' }}><Ticket size={18} color="#1c1917" /></span>
          <span className="os-row-label">Raise a support ticket</span>
        </button>
      )}
      {showPublicTicket && open && (
        <div style={{ padding: compact ? 8 : 12 }}>
          <PublicTicketForm />
        </div>
      )}
    </section>
  );
}
