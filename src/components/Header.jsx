import React, { useState, useEffect } from 'react';
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
  X
} from 'lucide-react';
import { motion } from 'framer-motion';
import { RefreshButton } from './RefreshButton';

export const Header = ({ activeTab, setActiveTab, onOpenNewStudent }) => {
  const { 
    settings, 
    branches, 
    activeBranchId, 
    setActiveBranchId, 
    staffMembers, 
    currentStaff, 
    setCurrentStaff,
    hasPermission
  } = useLibrary();

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'students', label: 'Students', icon: Users },
    { id: 'seats', label: 'Seat Map', icon: Grid },
    { id: 'payments', label: 'Payments & Fees', icon: CreditCard },
    { id: 'expenses', label: 'Expenses', icon: Receipt },
    { id: 'reports', label: 'Reports & P&L', icon: BarChart3 },
    { id: 'settings', label: 'Library Settings', icon: Settings }
  ];

  const visibleTabs = tabs.filter(t => {
    if (t.id === 'dashboard') return true;
    return hasPermission(t.id, 'view');
  });

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
            <p style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>Library Management OS</p>
          </div>
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

          {/* Global Refresh Button */}
          <RefreshButton />
        </div>
      </div>

      {/* Main Navigation Bar */}
      <nav className={`header-nav ${drawerOpen ? 'drawer-open' : ''}`} style={{ display: 'flex', gap: '4px', padding: '0 24px', overflowX: 'auto', position: 'relative' }}>
        {visibleTabs.map(t => {
          const Icon = t.icon;
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              id={`nav-tab-${t.id}`}
              onClick={() => setActiveTab(t.id)}
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
      </nav>

      {/* Rendered into <body>: the glass header's backdrop-filter would otherwise trap position:fixed */}
      {drawerOpen && createPortal(<div className="mobile-drawer-backdrop mobile-only" onClick={() => setDrawerOpen(false)} />, document.body)}

      {/* Mobile bottom tab bar */}
      {createPortal(<nav className="mobile-bottom-nav mobile-only" aria-label="Primary">
        {primaryMobileTabs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} id={`bottom-tab-${t.id}`} className={activeTab === t.id ? 'active' : ''} onClick={() => setActiveTab(t.id)}>
              <Icon size={20} />
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
