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
import { Toaster } from 'react-hot-toast';
import { ShieldAlert } from 'lucide-react';
import { PreviousStudentRecords } from './components/PreviousStudentRecords';
import { SetupWizard } from './components/SetupWizard';
import { useLibrary } from './context/LibraryContext';
import { AuthProvider, useAuth, prepareLocalCacheFor } from './auth/AuthContext';
import { LoginScreen } from './auth/LoginScreen';
import { SuperAdminDashboard } from './auth/SuperAdminDashboard';
import { setTenantContext } from './utils/api';
import { ArrowLeft, LogOut, Eye } from 'lucide-react';

const pageVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 }
};

export const AppContent = () => {
  const { settings, hasPermission } = useLibrary();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isNewStudentModalOpen, setIsNewStudentModalOpen] = useState(false);
  const [waitlistPayload, setWaitlistPayload] = useState(null);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [renewActionStudent, setRenewActionStudent] = useState(null);
  const [relocateActionStudent, setRelocateActionStudent] = useState(null);
  const [activeReceiptToPrint, setActiveReceiptToPrint] = useState(null);
  
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

      {/* Main Page Body Container */}
      <div className="page-body-wrapper" style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        {/* Scroller for the main content */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
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
            {!hasPermission(activeTab, 'view') && activeTab !== 'dashboard' && activeTab !== 'archives' ? (
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

                {activeTab === 'archives' && (
                  <PreviousStudentRecords setActiveTab={setActiveTab} />
                )}
              </>
            )}
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

/** Thin bar above the app showing who is signed in, read-only state and navigation. */
const SessionBar = ({ libraryName, readOnly, onBack }) => {
  const { user, logout } = useAuth();
  return (
    <div id="session-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '6px 16px', fontSize: 12, background: readOnly ? '#fef3c7' : '#111827', color: readOnly ? '#92400e' : '#e5e7eb' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {onBack && <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ color: 'inherit' }}><ArrowLeft size={14} /> <span>All libraries</span></button>}
        <span>{libraryName}</span>
        {readOnly && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}><Eye size={12} /> Read-only view</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span>{user?.email} · {user?.role === 'superadmin' ? 'Super Admin' : user?.role === 'client_admin' ? 'Client Admin' : 'Staff'}</span>
        <button className="btn btn-ghost btn-sm" onClick={logout} style={{ color: 'inherit' }}><LogOut size={14} /> <span>Sign out</span></button>
      </div>
    </div>
  );
};

const LibraryWorkspace = ({ libraryId, libraryName, readOnly = false, lockedStaffId = null, onBack }) => {
  // Configure tenant headers and the per-library local cache BEFORE the provider reads localStorage
  const [ready, setReady] = useState(false);
  React.useLayoutEffect(() => {
    setTenantContext(onBack ? { libraryId, readOnly } : {});
    prepareLocalCacheFor(`${libraryId}${readOnly ? ':ro' : ''}`);
    setReady(true);
  }, [libraryId, readOnly, onBack]);
  if (!ready) return null;
  return (
    <div className="lib-workspace" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <SessionBar libraryName={libraryName} readOnly={readOnly} onBack={onBack} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <LibraryProvider key={`${libraryId}-${readOnly}`} readOnly={readOnly} lockedStaffId={lockedStaffId}>
          <AppContent />
        </LibraryProvider>
      </div>
    </div>
  );
};

const RoleRouter = () => {
  const { status, user, library } = useAuth();
  const [drill, setDrill] = useState(null); // super admin: { library, readOnly }

  if (status === 'loading') return <div style={{ padding: 48, textAlign: 'center' }}>Loading…</div>;
  if (status !== 'authenticated' || !user) return <LoginScreen />;

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
