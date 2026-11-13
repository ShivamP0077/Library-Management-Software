import React, { useState, useEffect } from 'react';
import { NotificationBell } from './NotificationBell';
import { createPortal } from 'react-dom';
import { useLibrary } from '../context/LibraryContext';
import { 
  Building2, 
  UserCheck, 
  PlusCircle, 
  LayoutDashboard, 
  Users, 
  Grid, 
  CreditCard, 
  Receipt, 
  BarChart3, 
  Settings,
  ShieldCheck,
  Menu,
  X,
  RefreshCw,
  MessageCircle,
  CircleUser,
  ChevronRight,
} from 'lucide-react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { useAuth } from '../auth/AuthContext';
import { isLibraryLocked } from '../utils/subscriptionLock';
import { useWaitingEnquiryCount } from './enquiry/useWaitingEnquiryCount';
import { badgeCount } from '../utils/enquiry';

export const Header = ({ activeTab, setActiveTab, onOpenNewStudent }) => {
  const { 
    settings, 
    branches, 
    activeBranchId, 
    setActiveBranchId, 
    staffMembers, 
    currentStaff, 
    setCurrentStaff,
    hasPermission,
    refreshData,
    isRefreshing
  } = useLibrary();
  const { user, library, subscriptionAccess } = useAuth() || {};
  const enquiryBadge = badgeCount(useWaitingEnquiryCount(isLibraryLocked(subscriptionAccess, user)));

  const handleRefresh = async () => {
    if (isRefreshing) return;
    try {
      const refreshed = await refreshData();
      if (refreshed === 'locked') return;
      if (refreshed) {
        toast.success('Data refreshed successfully.');
      } else {
        toast.error('No data available on the server.');
      }
    } catch (e) {
      if (e?.code === 'SUBSCRIPTION_LOCKED' || e?.status === 402) return;
      toast.error('Could not refresh data. Please try again.');
    }
  };

  // Same rule as the server's canManageWhatsapp (owner, Admin/Manager, or settings manage/edit).
  const canManageWhatsapp = !currentStaff || currentStaff.role === 'Admin' || currentStaff.role === 'Manager' || hasPermission('settings', 'manage') || hasPermission('settings', 'edit');

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'students', label: 'Students', icon: Users },
    { id: 'seats', label: 'Seat Map', icon: Grid },
    { id: 'payments', label: 'Payments & Fees', icon: CreditCard },
    { id: 'expenses', label: 'Expenses', icon: Receipt },
    { id: 'reports', label: 'Reports & P&L', icon: BarChart3 },
    { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
    { id: 'settings', label: 'Library Settings', icon: Settings },
  ];

  const visibleTabs = tabs.filter(t => {
    if (t.id === 'dashboard') return true;
    if (t.id === 'whatsapp') return canManageWhatsapp;
    return hasPermission(t.id, 'view');
  });
  const ownerName = user?.name || 'Owner';
  const ownerInitial = (user?.name || user?.email || 'M').trim().charAt(0).toUpperCase() || 'M';
  const libraryName = settings?.name || library?.name || 'Library';
  const openProfile = () => {
    setDrawerOpen(false);
    window.dispatchEvent(new CustomEvent('libos:navigate', { detail: { tab: 'profile', screen: 'home' } }));
  };

  // Mobile: hamburger drawer (all tabs + switchers) and a bottom tab bar for primary tabs
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => { setDrawerOpen(false); }, [activeTab]);
  const primaryMobileTabs = visibleTabs.filter(t => ['dashboard', 'students', 'seats', 'payments'].includes(t.id));

  return (
    <header className="glass-panel" style={{ position: 'sticky', top: 0, zIndex: 100 }}>
      {/* Top Bar: Brand, Branch & Staff Switcher */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.875rem 1.5rem', borderBottom: '1px solid var(--border-color)' }}>
        
        {/* Brand */}
        <div className="header-brand" style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
          <button
            id="mobile-nav-toggle"
            className="mobile-only icon-btn"
            aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(o => !o)}
          >
            {drawerOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div style={{ fontSize: '28px', lineHeight: 1 }}>{settings.logo}</div>
          <div style={{ minWidth: 0 }}>
            <h1 className="header-title" style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{settings.name}</h1>
            <p style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>My Library OS</p>
          </div>
        </div>

        <div className="mobile-only" style={{ marginLeft: 'auto' }}>
          <NotificationBell onOpen={() => { setDrawerOpen(false); setActiveTab('notifications'); }} />
        </div>

        {/* Right Controls: Branch Switcher, Staff Switcher, New Student CTA */}
        <div className={`header-controls ${drawerOpen ? 'drawer-open' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          
          {/* Branch Selector */}
          {branches.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(0,0,0,0.03)', padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-light)' }}>
              <Building2 size={14} color="var(--text-secondary)" />
              <select
                value={activeBranchId}
                onChange={(e) => setActiveBranchId(e.target.value)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: '13px', fontWeight: 500, outline: 'none', cursor: 'pointer' }}
              >
                <option value="all">All Branches</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Role & Staff Switcher */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(0,0,0,0.03)', padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-light)' }}>
            <UserCheck size={14} color="var(--text-secondary)" />
            <select
              value={currentStaff?.id || ''}
              onChange={(e) => {
                const s = staffMembers.find(st => st.id === e.target.value);
                if (s) setCurrentStaff(s);
              }}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: '13px', fontWeight: 500, outline: 'none', cursor: 'pointer' }}
            >
              {staffMembers.map(st => (
                <option key={st.id} value={st.id}>
                  {st.name} ({st.role})
                </option>
              ))}
            </select>
          </div>

          {/* Quick Add Button */}
          {hasPermission('students', 'create') && (
            <button className="btn btn-primary btn-sm" onClick={onOpenNewStudent}>
              <PlusCircle size={16} />
              <span>New Student</span>
            </button>
          )}

          <NotificationBell onOpen={() => setActiveTab('notifications')} />

          {/* Global Refresh Button (data-only refresh, no page reload) */}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            title="Refresh Data"
            aria-label="Refresh Data"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              background: '#111827',
              color: '#ffffff',
              border: '1px solid #1f2937',
              cursor: isRefreshing ? 'not-allowed' : 'pointer',
              opacity: isRefreshing ? 0.7 : 1,
              transition: 'all 0.2s ease',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
              flexShrink: 0
            }}
          >
            <motion.div
              animate={{ rotate: isRefreshing ? 360 : 0 }}
              transition={{ duration: 1, repeat: isRefreshing ? Infinity : 0, ease: 'linear' }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <RefreshCw size={15} color="#ffffff" />
            </motion.div>
          </button>
        </div>
      </div>

      {drawerOpen && (
        <button
          type="button"
          id="drawer-profile-card"
          className="mobile-drawer-profile"
          onClick={openProfile}
          aria-label="My Library OS Profile"
        >
          <span className="mobile-drawer-avatar" aria-hidden="true">{ownerInitial}</span>
          <span className="mobile-drawer-profile-text">
            <strong>My Library OS Profile</strong>
            <span>{ownerName}</span>
            <span>{libraryName}</span>
          </span>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      )}

      {/* Main Navigation Bar */}
      <nav className={`header-nav ${drawerOpen ? 'drawer-open' : ''}`} style={{ display: 'flex', gap: '4px', padding: '0 24px', overflowX: 'auto', position: 'relative' }}>
        {visibleTabs.map(t => {
          const Icon = t.icon;
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              id={`nav-tab-${t.id}`}
              onClick={() => { setDrawerOpen(false); setActiveTab(t.id); }}
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '16px 12px',
                background: 'transparent',
                border: 'none',
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: 500,
                fontSize: '14px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'color 0.2s ease',
                outline: 'none'
              }}
            >
              <Icon size={16} />
              <span>{t.label}</span>
              {t.id === 'students' && enquiryBadge && (
                <span aria-label={`${enquiryBadge} waiting enquiries`} style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, background: '#dc2626', color: '#fff', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{enquiryBadge}</span>
              )}
              {isActive && (
                <motion.div
                  layoutId="activeTabIndicator"
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: '2px',
                    background: 'var(--brand-primary)',
                    borderRadius: '2px 2px 0 0'
                  }}
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                />
              )}
            </button>
          );
        })}
        <button
          type="button"
          id="nav-tab-profile"
          className="header-profile-tab"
          aria-current={activeTab === 'profile' ? 'page' : undefined}
          onClick={openProfile}
          style={{
            position: 'sticky',
            right: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '16px 12px',
            marginLeft: 'auto',
            background: 'var(--bg-surface, #fff)',
            border: 'none',
            color: activeTab === 'profile' ? 'var(--text-primary)' : 'var(--text-secondary)',
            fontWeight: activeTab === 'profile' ? 700 : 600,
            fontSize: '14px',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            zIndex: 2,
          }}
        >
          <CircleUser size={16} />
          <span>My Library OS Profile</span>
          {activeTab === 'profile' && (
            <motion.div
              layoutId="activeTabIndicator"
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: '2px',
                background: 'var(--brand-primary)',
                borderRadius: '2px 2px 0 0'
              }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            />
          )}
        </button>
      </nav>

      {/* Rendered into <body>: the glass header's backdrop-filter would otherwise trap position:fixed */}
      {drawerOpen && createPortal(<div className="mobile-drawer-backdrop mobile-only" onClick={() => setDrawerOpen(false)} />, document.body)}

      {/* Mobile bottom tab bar */}
      {createPortal(<nav className="mobile-bottom-nav mobile-only" aria-label="Primary">
        {primaryMobileTabs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} id={`bottom-tab-${t.id}`} className={activeTab === t.id ? 'active' : ''} onClick={() => setActiveTab(t.id)} style={{ position: 'relative' }}>
              <Icon size={20} />
              {t.id === 'students' && enquiryBadge && (
                <span aria-label={`${enquiryBadge} waiting enquiries`} style={{ position: 'absolute', top: 2, right: 8, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 999, background: '#dc2626', color: '#fff', fontSize: 9, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{enquiryBadge}</span>
              )}
              <span>{t.label.split(' ')[0]}</span>
            </button>
          );
        })}
        <button className={drawerOpen ? 'active' : ''} onClick={() => setDrawerOpen(o => !o)} aria-label="More">
          <Menu size={20} />
          <span>More</span>
        </button>
      </nav>, document.body)}
    </header>
  );
};
