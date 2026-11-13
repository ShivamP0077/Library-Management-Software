import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft, Building2, ChevronRight, CreditCard, FileText, Info, KeyRound, Languages,
  LogOut, Mail, Moon, Phone, Shield, Wallet,
} from 'lucide-react';
import pkg from '../../../package.json';
import { useAuth } from '../../auth/AuthContext';
import { ChangePasswordModal } from '../../auth/ChangePasswordModal';
import { MySoftwarePlanModal } from '../../auth/MySoftwarePlanModal';
import { useLibrary } from '../../context/LibraryContext';
import { SupportCenter } from '../SupportCenter';
import { applyTheme, readTheme } from '../../utils/theme';
import { isLibraryLocked } from '../../utils/subscriptionLock';
import { SUPPORT_EMAIL, SUPPORT_PHONE, SUPPORT_WHATSAPP, whatsappHref } from '../../utils/support';
import { SubscriptionPage } from './SubscriptionPage';
import './profile.css';

function Row({ icon: Icon, tint, label, value, onClick, danger = false }) {
  return (
    <button type="button" className={`os-row${danger ? ' os-row-danger' : ''}`} onClick={onClick}>
      <span className="os-icon" style={{ background: tint }}><Icon size={18} color={danger ? '#dc2626' : '#1c1917'} /></span>
      <span className="os-row-label">{label}</span>
      {value && <span className="os-row-value">{value}</span>}
      {!danger && <ChevronRight size={18} className="os-chevron" />}
    </button>
  );
}

function Subpage({ title, onBack, children }) {
  return (
    <div className="os-profile-inner">
      <div className="os-profile-top">
        <button type="button" className="os-back" onClick={onBack} aria-label="Back"><ArrowLeft size={18} /></button>
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}

export function LibraryOsProfile({ screen = 'home', onScreenChange, onClose, onPaid }) {
  const { user, library, logout, subscriptionAccess } = useAuth();
  const { settings, branches, activeBranchId, setActiveBranchId } = useLibrary();
  const [dark, setDark] = useState(() => readTheme() === 'dark');
  const [langOpen, setLangOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const canPay = user?.role === 'client_admin' || user?.role === 'superadmin';
  const planLocked = isLibraryLocked(subscriptionAccess, user);
  const name = user?.name || 'Owner';
  const initial = (name || user?.email || 'M').trim().charAt(0).toUpperCase();
  const libraryName = library?.name || settings?.name || 'Library';

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const go = (next) => onScreenChange?.(next === 'support' ? 'contact' : next);
  const view = screen === 'support' ? 'contact' : screen;

  useEffect(() => {
    if (screen === 'support') onScreenChange?.('contact');
  }, [screen, onScreenChange]);

  const home = (
    <div className="os-profile-inner">
      <div className="os-profile-top">
        <button type="button" className="os-back" onClick={onClose} aria-label="Close profile"><ArrowLeft size={18} /></button>
        <h2>My Library OS Profile</h2>
      </div>

      <section className="os-card os-card-pad">
        <div className="os-profile-hero">
          <div className="os-avatar" aria-hidden="true">{initial}</div>
          <div style={{ minWidth: 0 }}>
            <h3>{name}</h3>
            <p className="os-muted">{user?.email || user?.mobile || 'No email on file'}</p>
            <p className="os-muted">{libraryName}</p>
          </div>
        </div>
        {branches.length > 1 && (
          <div className="os-branch">
            <Building2 size={16} color="var(--text-secondary)" />
            <select aria-label="Branch" value={activeBranchId} onChange={e => setActiveBranchId(e.target.value)}>
              <option value="all">All Branches</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
      </section>

      <section className="os-card">
        <div className="os-row" style={{ cursor: 'default' }}>
          <span className="os-icon" style={{ background: '#e0e7ff' }}><Moon size={18} color="#1c1917" /></span>
          <span className="os-row-label">Dark mode</span>
          <button
            type="button"
            className="os-switch"
            role="switch"
            aria-checked={dark}
            aria-label="Dark mode"
            onClick={() => { const next = applyTheme(dark ? 'light' : 'dark'); setDark(next === 'dark'); }}
          ><i /></button>
        </div>
        <button type="button" className="os-row" onClick={() => setLangOpen(true)}>
          <span className="os-icon" style={{ background: '#d1fae5' }}><Languages size={18} color="#1c1917" /></span>
          <span className="os-row-label">Language</span>
          <span className="os-row-value">English</span>
          <ChevronRight size={18} className="os-chevron" />
        </button>
      </section>

      <section className="os-card">
        <Row icon={CreditCard} tint="#dbeafe" label="Subscription" onClick={() => go('subscription')} />
        <Row icon={Wallet} tint="#fef3c7" label="Wallet" onClick={() => { if (canPay) setWalletOpen(true); else go('subscription'); }} />
        <Row icon={KeyRound} tint="#e7e5e4" label="Change Password" onClick={() => setPwOpen(true)} />
        <Row icon={Phone} tint="#dcfce7" label="Contact Us" onClick={() => go('contact')} />
        <Row icon={Shield} tint="#ede9fe" label="Privacy Policy" onClick={() => go('privacy')} />
        <Row icon={FileText} tint="#e0e7ff" label="Terms & Conditions" onClick={() => go('terms')} />
        <Row icon={Info} tint="#ccfbf1" label="About" onClick={() => go('about')} />
      </section>

      <section className="os-card">
        <Row icon={LogOut} tint="#fee2e2" label="Sign out" onClick={logout} danger />
      </section>
    </div>
  );

  let body = home;
  if (view === 'subscription') {
    body = <SubscriptionPage onBack={() => go('home')} onPaid={onPaid} canPay={canPay} locked={planLocked} />;
  } else if (view === 'contact') {
    body = (
      <Subpage title="Contact Us" onBack={() => go('home')}>
        <section className="os-card os-contact">
          <a className="os-row" href={`mailto:${SUPPORT_EMAIL}`}>
            <span className="os-icon" style={{ background: '#dbeafe' }}><Mail size={18} color="#1c1917" /></span>
            <span className="os-row-label">Email</span>
            <span className="os-row-value">{SUPPORT_EMAIL}</span>
          </a>
          {SUPPORT_PHONE && (
            <div className="os-row" style={{ cursor: 'default' }}>
              <span className="os-icon" style={{ background: '#dcfce7' }}><Phone size={18} color="#1c1917" /></span>
              <span className="os-row-label">Phone</span>
              <span className="os-row-value"><a href={`tel:${SUPPORT_PHONE}`}>{SUPPORT_PHONE}</a></span>
            </div>
          )}
          {SUPPORT_WHATSAPP && whatsappHref(SUPPORT_WHATSAPP) && (
            <div className="os-row" style={{ cursor: 'default' }}>
              <span className="os-icon" style={{ background: '#d1fae5' }}><Phone size={18} color="#1c1917" /></span>
              <span className="os-row-label">WhatsApp</span>
              <span className="os-row-value"><a href={whatsappHref(SUPPORT_WHATSAPP)} target="_blank" rel="noreferrer">Chat</a></span>
            </div>
          )}
        </section>
        <SupportCenter embedded />
      </Subpage>
    );
  } else if (view === 'privacy') {
    body = (
      <Subpage title="Privacy Policy" onBack={() => go('home')}>
        <section className="os-card os-card-pad os-legal">
          <p>My Library OS stores library records so the owner and staff can run admissions, seats, fees and reminders. A full privacy policy page is not published in this app yet. This screen is a placeholder until that page is linked.</p>
        </section>
      </Subpage>
    );
  } else if (screen === 'terms') {
    body = (
      <Subpage title="Terms & Conditions" onBack={() => go('home')}>
        <section className="os-card os-card-pad os-legal">
          <p>Use of My Library OS is covered by the agreement between your library and the platform. A full terms page is not published in this app yet. This screen is a placeholder until that page is linked.</p>
        </section>
      </Subpage>
    );
  } else if (screen === 'about') {
    body = (
      <Subpage title="About" onBack={() => go('home')}>
        <section className="os-card os-card-pad os-legal">
          <h3 style={{ marginTop: 0 }}>My Library OS</h3>
          <p>Version {pkg.version}</p>
          <p>Software for reading rooms and study libraries: students, seats, fees, expenses and reminders in one place.</p>
        </section>
      </Subpage>
    );
  }

  return createPortal(
    <div className="os-profile-sheet" role="dialog" aria-modal="true" aria-label="My Library OS Profile">
      {body}
      {langOpen && (
        <div className="os-sheet-backdrop" onClick={() => setLangOpen(false)}>
          <div className="os-sheet" role="dialog" aria-label="Language" onClick={e => e.stopPropagation()}>
            <div className="os-sheet-title">Language</div>
            <div className="os-row" style={{ cursor: 'default' }}>
              <span className="os-row-label">English</span>
              <span className="os-row-value">Selected</span>
            </div>
            <div className="os-row" style={{ cursor: 'default' }}>
              <span className="os-row-label">हिन्दी</span>
              <span className="os-soon">Coming soon</span>
            </div>
          </div>
        </div>
      )}
      {pwOpen && <ChangePasswordModal onClose={() => setPwOpen(false)} hasPassword={!(user?.authProviders?.length && !user.authProviders.includes('password'))} />}
      {walletOpen && <MySoftwarePlanModal onClose={() => setWalletOpen(false)} />}
    </div>,
    document.body,
  );
}
