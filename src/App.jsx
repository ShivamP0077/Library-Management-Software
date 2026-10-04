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

export default function App() {
  return (
    <LibraryProvider>
      <AppContent />
    </LibraryProvider>
  );
}
