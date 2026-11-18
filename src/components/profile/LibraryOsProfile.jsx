import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft, Building2, ChevronRight, CreditCard, FileText, Info, KeyRound, Languages,
  LogOut, Moon, Phone, Shield, Wallet,
} from 'lucide-react';
import pkg from '../../../package.json';
import { useAuth } from '../../auth/AuthContext';
import { ChangePasswordModal } from '../../auth/ChangePasswordModal';
import { MySoftwarePlanModal } from '../../auth/MySoftwarePlanModal';
import { useLibrary } from '../../context/LibraryContext';
import { SupportCenter } from '../SupportCenter';
import { applyTheme, readTheme } from '../../utils/theme';
import { isLibraryLocked } from '../../utils/subscriptionLock';
import { legalHref } from '../../utils/support';
import { ContactChoices } from '../ContactChoices';
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
  const { settings, branches, activeBranchId, setActiveBranchId, currentStaff, hasPermission } = useLibrary();
  const [dark, setDark] = useState(() => readTheme() === 'dark');
  const [langOpen, setLangOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const canPay = user?.role === 'client_admin' || user?.role === 'superadmin';
  const librarianBlocked = currentStaff?.role === 'Librarian';
  const showWallet = !librarianBlocked && (canPay || hasPermission?.('wallet', 'view'));
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
        {showWallet && <Row icon={Wallet} tint="#fef3c7" label="Wallet" onClick={() => { if (canPay || hasPermission?.('wallet', 'view')) setWalletOpen(true); else go('subscription'); }} />}
        <Row icon={KeyRound} tint="#e7e5e4" label="Change Password" onClick={() => setPwOpen(true)} />
        <Row icon={Phone} tint="#dcfce7" label="Contact Us" onClick={() => go('contact')} />
        <Row icon={Shield} tint="#ede9fe" label="Privacy Policy" onClick={() => go('privacy')} />
        <Row icon={FileText} tint="#e0e7ff" label="Terms & Conditions" onClick={() => go('terms')} />
        <Row icon={Info} tint="#ccfbf1" label="About" onClick={() => go('about')} />
        <Row icon={FileText} tint="#fce7f3" label="Refund & Cancellation" onClick={() => go('refund')} />
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
        <ContactChoices showPublicTicket={false} />
        <h3 className="os-row-label" style={{ margin: '12px 4px' }}>Raise a support ticket</h3>
        <SupportCenter embedded />
      </Subpage>
    );
  } else if (view === 'privacy' || view === 'terms' || view === 'refund') {
    const legal = {
      privacy: ['Privacy Policy', '/privacy'],
      terms: ['Terms & Conditions', '/terms'],
      refund: ['Refund & Cancellation', '/refund'],
    }[view];
    body = (
      <Subpage title={legal[0]} onBack={() => go('home')}>
        <section className="os-card os-card-pad os-legal">
          <p>This page is published on the My Library OS site.</p>
          <p><a href={legalHref(legal[1])}>{legal[0]}</a></p>
        </section>
      </Subpage>
    );
  } else if (view === 'about') {
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
