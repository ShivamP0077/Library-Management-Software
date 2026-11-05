import React, { useState } from 'react';
import { LibraryProvider } from './context/LibraryContext';
import { Header } from './components/Header';
import { Dashboard } from './components/Dashboard';
import { StudentManager } from './components/StudentManager';
import { SeatMap } from './components/SeatMap';
import { PaymentManager } from './components/PaymentManager';
import { ExpenseManager } from './components/ExpenseManager';
import { ReportsManager } from './components/ReportsManager';
import { LibrarySettings } from './components/LibrarySettings';
import { NewStudentModal } from './components/Modals/NewStudentModal';
import { PrintReceiptModal } from './components/Modals/PrintReceiptModal';
import { motion, AnimatePresence } from 'framer-motion';
import toast, { Toaster } from 'react-hot-toast';
import { ShieldAlert, ArrowLeft, LogOut, Eye, WifiOff, Cloud, KeyRound, CreditCard } from 'lucide-react';
import { ChangePasswordModal } from './auth/ChangePasswordModal';
import { MySubscriptionModal } from './auth/MySubscriptionModal';
import { initHistory, navTab, TAB_FROM_HASH } from './utils/appHistory';
import { useBackClose } from './utils/useBackClose';
import { NotificationsCenter } from './components/NotificationsCenter';
import { SupportCenter } from './components/SupportCenter';
import { PreviousStudentRecords } from './components/PreviousStudentRecords';
import { SetupWizard } from './components/SetupWizard';
import { useLibrary } from './context/LibraryContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthProvider, useAuth, prepareLocalCacheFor } from './auth/AuthContext';
import { setCacheScope, clearCacheScope } from './utils/tenantCache';
import { LoginScreen } from './auth/LoginScreen';
import { SuperAdminDashboard } from './auth/SuperAdminDashboard';
import { PartnerPortal } from './auth/PartnerPortal';
import { setTenantContext } from './utils/api';
import { WhatsAppHub } from './components/WhatsAppHub';
import { WhatsAppBanner } from './components/WhatsAppBanner';

const pageVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 }
};

export const AppContent = () => {
  const { settings, hasPermission, currentStaff } = useLibrary();
  const KNOWN_TABS = ['dashboard', 'students', 'seats', 'payments', 'expenses', 'reports', 'settings', 'whatsapp', 'archives', 'notifications', 'support'];
  const [activeTab, setActiveTab] = useState(() => { const t = TAB_FROM_HASH(); return KNOWN_TABS.includes(t) ? t : 'dashboard'; });
  // Issue #1: browser Back/Forward move between screens.
  React.useEffect(() => initHistory(activeTab, (t) => { if (KNOWN_TABS.includes(t)) setActiveTab(t); }), []); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { navTab(activeTab); }, [activeTab]);
  React.useEffect(() => {
    const onStart = () => toast('You are on the first screen. Use Sign out to leave.', { id: 'back-at-start' });
    window.addEventListener('libos:back-at-start', onStart);
    return () => window.removeEventListener('libos:back-at-start', onStart);
  }, []);
  const [whatsappPage, setWhatsappPage] = useState('messages');
  const canManageWhatsapp = !currentStaff || currentStaff.role === 'Admin' || currentStaff.role === 'Manager' || hasPermission('settings', 'manage') || hasPermission('settings', 'edit');
  // Deep links from anywhere (banner Reconnect, Settings shortcuts): navigateTo(tab, sub)
  React.useEffect(() => {
    const onNav = (e) => { const { tab, sub } = e.detail || {}; if (tab === 'whatsapp' && sub) setWhatsappPage(sub); if (tab) setActiveTab(tab); };
    window.addEventListener('libos:navigate', onNav);
    return () => window.removeEventListener('libos:navigate', onNav);
  }, []);
  const [isNewStudentModalOpen, setIsNewStudentModalOpen] = useState(false);
  const [waitlistPayload, setWaitlistPayload] = useState(null);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [renewActionStudent, setRenewActionStudent] = useState(null);
  const [relocateActionStudent, setRelocateActionStudent] = useState(null);
  const [activeReceiptToPrint, setActiveReceiptToPrint] = useState(null);
  // Back closes these first (issue #1).
  useBackClose(isNewStudentModalOpen, () => setIsNewStudentModalOpen(false));
  useBackClose(!!selectedStudent, () => setSelectedStudent(null));
  useBackClose(!!activeReceiptToPrint, () => setActiveReceiptToPrint(null));
  
  // Integrity deep-link action & Setup Wizard state
  const [settingsAction, setSettingsAction] = useState(null);
  const [isSetupWizardOpen, setIsSetupWizardOpen] = useState(false);
  const [isSetupWizardEditMode, setIsSetupWizardEditMode] = useState(false);

  const handlePrintReceipt = (receipt) => {
    setActiveReceiptToPrint(receipt);
  };

  const handleIntegrityAction = (issue) => {
    setSettingsAction(issue);
    setActiveTab('settings');
  };

  const handleOpenSetupWizard = (isEdit = false) => {
    setIsSetupWizardEditMode(isEdit);
    setIsSetupWizardOpen(true);
  };

  return (
    <div className="app-container">
      {/* Header Bar */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenNewStudent={(payload) => {
          if (payload) setWaitlistPayload(payload);
          setIsNewStudentModalOpen(true);
        }}
      />

      <WhatsAppBanner />
      {/* Main Page Body Container */}
      <div className="page-body-wrapper" style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        {/* Scroller for the main content */}
        <div className="page-scroller" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <main className="main-content">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                variants={pageVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
              >
                <ErrorBoundary componentName="Active Module">
            {!hasPermission(activeTab, 'view') && activeTab !== 'dashboard' && activeTab !== 'archives' && activeTab !== 'notifications' && activeTab !== 'support' && activeTab !== 'whatsapp' ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px 24px', textAlign: 'center', minHeight: '400px' }}>
                <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: '#fee2e2', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
                  <ShieldAlert size={32} />
                </div>
                <h3 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>Access Denied</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '14px', maxWidth: '420px', marginBottom: '24px' }}>
                  You do not have permission to view the {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} module. Please contact your system administrator.
                </p>
                <button className="btn btn-primary" onClick={() => setActiveTab('dashboard')}>
                  Return to Dashboard
                </button>
              </div>
            ) : (
              <>
                {activeTab === 'notifications' && <NotificationsCenter setActiveTab={setActiveTab} />}
                {activeTab === 'support' && <SupportCenter />}

                {activeTab === 'dashboard' && (
                  <Dashboard
                    setActiveTab={setActiveTab}
                    onOpenNewStudent={(payload) => {
                      if (payload) setWaitlistPayload(payload);
                      setIsNewStudentModalOpen(true);
                    }}
                    onSelectStudent={(s) => setSelectedStudent(s)}
                    onTriggerRenew={(s) => {
                      setSelectedStudent(s);
                      setRenewActionStudent(s);
                      setActiveTab('students');
                    }}
                    onHandleIntegrityAction={handleIntegrityAction}
                    onOpenSetupWizard={handleOpenSetupWizard}
                  />
                )}

                {activeTab === 'students' && (
                  <StudentManager
                    onOpenNewStudent={(payload) => {
                      if (payload) setWaitlistPayload(payload);
                      setIsNewStudentModalOpen(true);
                    }}
                    selectedStudent={selectedStudent}
                    setSelectedStudent={setSelectedStudent}
                    setActiveTab={setActiveTab}
                    renewActionStudent={renewActionStudent}
                    setRenewActionStudent={setRenewActionStudent}
                    relocateActionStudent={relocateActionStudent}
                    setRelocateActionStudent={setRelocateActionStudent}
                  />
                )}

                {activeTab === 'seats' && (
                  <SeatMap
                    onSelectStudent={(s) => { setSelectedStudent(s); setActiveTab('students'); }}
                    onRelocateStudent={(s) => { setSelectedStudent(s); setRelocateActionStudent(s); setActiveTab('students'); }}
                    onOpenNewStudent={(payload) => {
                      if (payload) setWaitlistPayload(payload);
                      setIsNewStudentModalOpen(true);
                    }}
                  />
                )}

                {activeTab === 'payments' && (
                  <PaymentManager
                    onPrintReceipt={handlePrintReceipt}
                  />
                )}

                {activeTab === 'expenses' && (
                  <ExpenseManager />
                )}

                {activeTab === 'reports' && (
                  <ReportsManager />
                )}

                {activeTab === 'settings' && (
                  <LibrarySettings 
                    settingsAction={settingsAction}
                    onClearSettingsAction={() => setSettingsAction(null)}
                    onOpenSetupWizard={handleOpenSetupWizard}
                  />
                )}

                {activeTab === 'whatsapp' && (
                  <WhatsAppHub page={whatsappPage} setPage={setWhatsappPage} canManage={canManageWhatsapp} />
                )}
                {activeTab === 'archives' && (
                  <PreviousStudentRecords setActiveTab={setActiveTab} />
                )}
              </>
            )}
                </ErrorBoundary>
              </motion.div>
            </AnimatePresence>
          </main>
        </div>

        {/* Modals placed here or nested deeply will be bounded by page-body-wrapper */}
        <NewStudentModal
          isOpen={isNewStudentModalOpen}
          onClose={() => {
            setIsNewStudentModalOpen(false);
            setWaitlistPayload(null);
          }}
          onPrintReceipt={handlePrintReceipt}
          waitlistPayload={waitlistPayload}
        />

        <PrintReceiptModal
          receipt={activeReceiptToPrint}
          onClose={() => setActiveReceiptToPrint(null)}
        />

        {isSetupWizardOpen && (
          <SetupWizard
            isOpen={isSetupWizardOpen}
            onClose={() => setIsSetupWizardOpen(false)}
            isEditMode={isSetupWizardEditMode}
          />
        )}
        
        <Toaster position="bottom-right" />
      </div>
    </div>
  );
};

/** Thin bar above the app showing who is signed in, read-only state, offline mode, and navigation. */
const SessionBar = ({ libraryName, readOnly, onBack, isOffline = false, onSwitchToCloud }) => {
  const { user, logout } = useAuth();
  const [pwOpen, setPwOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  useBackClose(pwOpen, () => setPwOpen(false));
  return (
    <div id="session-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '6px 16px', fontSize: 12, background: readOnly ? '#fef3c7' : isOffline ? '#1e293b' : '#111827', color: readOnly ? '#92400e' : '#e5e7eb' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {onBack && <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ color: 'inherit' }}><ArrowLeft size={14} /> <span>All libraries</span></button>}
        <span style={{ fontWeight: 600 }}>{libraryName || 'Library'}</span>
        {readOnly && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}><Eye size={12} /> Read-only view</span>}
        {isOffline && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(56, 189, 248, 0.15)', padding: '2px 8px', borderRadius: 4, color: '#38bdf8', fontWeight: 600 }}>
            <WifiOff size={12} /> Local Offline Mode
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {isOffline ? (
          <button className="btn btn-ghost btn-sm" onClick={onSwitchToCloud} style={{ color: '#38bdf8' }}>
            <Cloud size={14} /> <span>Connect / Sign In</span>
          </button>
        ) : (
          <>
            <span><span className="session-email">{user?.email} · </span>{user?.role === 'superadmin' ? 'Super Admin' : user?.role === 'client_admin' ? 'Client Admin' : user?.role === 'partner' ? 'Partner' : user?.role === 'agent' ? 'Agent' : 'Staff'}</span>
            {!onBack && <button className="btn btn-ghost btn-sm" onClick={() => setPwOpen(true)} style={{ color: 'inherit' }} aria-label="Change password"><KeyRound size={14} /> <span>Password</span></button>}
            {!onBack && user?.role === 'client_admin' && <button className="btn btn-ghost btn-sm" onClick={() => setSubOpen(true)} style={{ color: 'inherit' }} aria-label="My subscription"><CreditCard size={14} /> <span>Plan</span></button>}
            <button className="btn btn-ghost btn-sm" onClick={logout} style={{ color: 'inherit' }}><LogOut size={14} /> <span>Sign out</span></button>
            {subOpen && <MySubscriptionModal libraryName={libraryName} onClose={() => setSubOpen(false)} />}
            {pwOpen && <ChangePasswordModal onClose={() => setPwOpen(false)} hasPassword={!(user?.authProviders?.length && !user.authProviders.includes('password'))} />}
          </>
        )}
      </div>
    </div>
  );
};

const LibraryWorkspace = ({ libraryId, libraryName, readOnly = false, lockedStaffId = null, onBack, isOffline = false, onSwitchToCloud }) => {
  const [ready, setReady] = useState(false);
  React.useLayoutEffect(() => {
    if (isOffline) {
      setCacheScope({ offline: true }); // offline mode keeps its original local cache
    } else if (libraryId) {
      setTenantContext(onBack ? { libraryId, readOnly } : {});
      prepareLocalCacheFor(libraryId, { readOnly });
    } else {
      clearCacheScope();
    }
    setReady(true);
  }, [libraryId, readOnly, onBack, isOffline]);

  if (!ready) return null;
  return (
    <div className="lib-workspace" style={{ display: 'flex', flexDirection: 'column' }}>
      <SessionBar libraryName={libraryName} readOnly={readOnly} onBack={onBack} isOffline={isOffline} onSwitchToCloud={onSwitchToCloud} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <LibraryProvider key={`${libraryId || 'local'}-${readOnly}-${isOffline}`} readOnly={readOnly} lockedStaffId={lockedStaffId}>
          <ErrorBoundary>
            <AppContent />
          </ErrorBoundary>
        </LibraryProvider>
      </div>
    </div>
  );
};

const RoleRouter = () => {
  const { status, user, library } = useAuth();
  const [drill, setDrill] = useState(null); // super admin: { library, readOnly }
  const [offlineMode, setOfflineMode] = useState(() => {
    return localStorage.getItem('library_mode_preference') === 'offline';
  });

  const handleContinueOffline = () => {
    localStorage.setItem('library_mode_preference', 'offline');
    setOfflineMode(true);
  };

  const handleSwitchToCloud = () => {
    localStorage.removeItem('library_mode_preference');
    setOfflineMode(false);
  };

  if (offlineMode) {
    return (
      <LibraryWorkspace
        libraryId="local-workspace"
        libraryName="Local Library"
        isOffline={true}
        onSwitchToCloud={handleSwitchToCloud}
      />
    );
  }

  if (status === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: 'var(--bg-primary, #f8fafc)' }}>
        <div style={{ fontSize: 36 }}>📖</div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Connecting to Library Management OS…</div>
        <button className="btn btn-secondary btn-sm" onClick={handleContinueOffline}>Continue in Local Offline Mode</button>
      </div>
    );
  }

  if (status !== 'authenticated' || !user) {
    return <LoginScreen onContinueOffline={handleContinueOffline} />;
  }

  if (user.role === 'superadmin') {
    if (drill) {
      return (
        <LibraryWorkspace
          libraryId={drill.library.libraryId}
          libraryName={drill.library.name}
          readOnly={drill.readOnly}
          onBack={() => { setTenantContext({}); setDrill(null); }}
        />
      );
    }
    return <SuperAdminDashboard onOpenLibrary={(lib, readOnly) => setDrill({ library: lib, readOnly })} />;
  }

  if (user.role === 'partner' || user.role === 'agent') {
    if (drill) {
      return (
        <LibraryWorkspace
          libraryId={drill.library.libraryId}
          libraryName={drill.library.name}
          readOnly
          onBack={() => { setTenantContext({}); setDrill(null); }}
        />
      );
    }
    return <PartnerPortal onOpenLibrary={(lib) => setDrill({ library: lib, readOnly: true })} />;
  }

  return (
    <LibraryWorkspace
      libraryId={user.libraryId}
      libraryName={library?.name || user.libraryId}
      lockedStaffId={user.role === 'staff' ? user.staffId : null}
    />
  );
};

export default function App() {
  return (
    <AuthProvider>
      <RoleRouter />
    </AuthProvider>
  );
}
