import React, { useState, useEffect } from 'react';
import { useLibrary } from '../context/LibraryContext';
import { motion } from 'framer-motion';
import { Building2, Plus, Trash2, CheckCircle, Clock, Copy, Eye, FileText, CheckCircle2, ShieldCheck, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { NumericInput } from './NumericInput';
import { resolveConfigurationScope, matchesScope } from '../utils/scopeResolver';

const INITIAL_SHIFT_TEMPLATES = [
  { name: "Full Day", startTime: "06:00", endTime: "20:00", daysOfWeek: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] },
  { name: "Morning", startTime: "06:00", endTime: "12:00", daysOfWeek: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] },
  { name: "Evening", startTime: "14:00", endTime: "20:00", daysOfWeek: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] },
  { name: "Weekend", startTime: "10:00", endTime: "18:00", daysOfWeek: ["Sat", "Sun"] }
];

const INITIAL_PLAN_TEMPLATES = [
  { name: "Full Day Plan" },
  { name: "Half Day Plan" },
  { name: "Weekend Plan" }
];

const STANDARD_DURATIONS = [1, 2, 3, 6, 12];
const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const SetupWizard = ({ isOpen = true, onClose, isEditMode = false }) => {
  const { 
    settings, setSettings,
    branches, setBranches,
    sections, setSections,
    seatTypes, setSeatTypes,
    seats, setSeats,
    shifts, setShifts,
    plans, setPlans,
    students
  } = useLibrary();

  // Draft Management
  const getDraft = () => {
    try {
      const draftStr = localStorage.getItem('wizardDraft');
      if (draftStr) return JSON.parse(draftStr);
    } catch(e) {}
    return null;
  };
  
  const [draft, setDraft] = useState(getDraft());
  const [step, setStep] = useState(draft?.step || 1);
  const totalSteps = 8;

  // Wizard State
  const [tempLibraryName, setTempLibraryName] = useState(draft?.tempLibraryName ?? (settings.name || ''));
  const [tempBranches, setTempBranches] = useState(draft?.tempBranches ?? (branches.length > 0 ? [...branches] : []));
  const [tempSections, setTempSections] = useState(draft?.tempSections ?? (sections.length > 0 ? [...sections] : []));
  const [tempSeatTypes, setTempSeatTypes] = useState(draft?.tempSeatTypes ?? (seatTypes.length > 0 ? [...seatTypes] : [
    { id: "st-fixed", name: "Standard Fixed", allocationMode: 'Fixed', capacityMode: null, maximumStudentsAllowed: null },
    { id: "st-flex", name: "Flexible Non-Fixed", allocationMode: 'Non-Fixed', capacityMode: 'Unlimited', maximumStudentsAllowed: null }
  ]));
  const [tempSeats, setTempSeats] = useState(draft?.tempSeats ?? [...seats]);
  const [tempShifts, setTempShifts] = useState(draft?.tempShifts ?? (shifts.length > 0 ? [...shifts] : [
    { id: "sh-1", name: "Full Day", startTime: "06:00", endTime: "20:00", daysOfWeek: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], active: true },
    { id: "sh-2", name: "Morning", startTime: "06:00", endTime: "12:00", daysOfWeek: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], active: true }
  ]));
  const [tempPlans, setTempPlans] = useState(draft?.tempPlans ?? [...plans]);
  const [tempDocTypes, setTempDocTypes] = useState(draft?.tempDocTypes ?? (settings.documentTypes && settings.documentTypes.length > 0 ? settings.documentTypes : [
    { id: "doc-aadhaar", name: "Aadhaar Card", requirement: "Required", active: true },
    { id: "doc-student-id", name: "Student ID", requirement: "Can Be Submitted Later", active: true },
    { id: "doc-address", name: "Address Proof", requirement: "Can Be Submitted Later", active: true },
    { id: "doc-photo", name: "Photograph", requirement: "Required", active: true },
    { id: "doc-other", name: "Other Document", requirement: "Not Required", active: true }
  ]));
  const [tempDocDeadlineDays, setTempDocDeadlineDays] = useState(draft?.tempDocDeadlineDays ?? (settings.idProofDeadlineDays || 7));
  const [newCustomDocName, setNewCustomDocName] = useState('');
  const [newCustomDocReq, setNewCustomDocReq] = useState('Can Be Submitted Later');

  // Scope Selection State for Multi-Branch/Section Configuration
  const [selectedBranchId, setSelectedBranchId] = useState(draft?.selectedBranchId || '');
  const [selectedSectionId, setSelectedSectionId] = useState(draft?.selectedSectionId || '');

  // Resolve current configuration scope using canonical algorithm
  const scope = resolveConfigurationScope({
    branches: tempBranches,
    sections: tempSections,
    selectedBranchId,
    selectedSectionId
  });

  // Step 4: Seat Map Generator Mode
  const [generatorMode, setGeneratorMode] = useState('simple'); // 'simple' | 'row'
  const [simplePrefix, setSimplePrefix] = useState('');
  const [simpleStart, setSimpleStart] = useState(1);
  const [simpleEnd, setSimpleEnd] = useState(25);
  const [selectedSeatTypeId, setSelectedSeatTypeId] = useState('');

  // Row based mode state
  const [rowConfigMode, setRowConfigMode] = useState('same'); // 'same' | 'different'
  const [rowNamesInput, setRowNamesInput] = useState('A, B, C');
  const [seatsPerRow, setSeatsPerRow] = useState(15);
  const [customRows, setCustomRows] = useState([
    { rowName: 'A', seatCount: 20 },
    { rowName: 'B', seatCount: 15 },
    { rowName: 'C', seatCount: 25 }
  ]);
  const [previewSeats, setPreviewSeats] = useState([]);

  // Step 5: Custom Shift form
  const [showCustomShiftForm, setShowCustomShiftForm] = useState(false);
  const [customShiftName, setCustomShiftName] = useState('');
  const [customShiftStart, setCustomShiftStart] = useState('07:00');
  const [customShiftEnd, setCustomShiftEnd] = useState('15:00');
  const [customShiftDays, setCustomShiftDays] = useState(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);

  // Step 6: Custom Plan Form
  const [showCustomPlanForm, setShowCustomPlanForm] = useState(false);
  const [customPlanName, setCustomPlanName] = useState('');

  // Auto-persist draft on step changes
  const saveDraft = (currentStep = step, showToast = true) => {
    const draftData = {
      step: currentStep,
      tempLibraryName,
      tempBranches,
      tempSections,
      tempSeatTypes,
      tempSeats,
      tempShifts,
      tempPlans,
      tempDocTypes,
      tempDocDeadlineDays,
      selectedBranchId: scope.resolvedBranchId,
      selectedSectionId: scope.resolvedSectionId
    };
    localStorage.setItem('wizardDraft', JSON.stringify(draftData));
    setDraft(draftData);
    if (showToast) toast.success('Progress saved as draft.');
  };

  // Live preview for seat generator in Step 4
  useEffect(() => {
    const preview = [];
    if (generatorMode === 'simple') {
      const start = Number(simpleStart) || 0;
      const end = Number(simpleEnd) || 0;
      if (start <= end && end - start <= 1000) {
        for (let i = start; i <= end; i++) {
          preview.push(`${simplePrefix}${i}`);
        }
      }
    } else {
      if (rowConfigMode === 'same') {
        const rows = rowNamesInput.split(',').map(r => r.trim()).filter(Boolean);
        const count = Number(seatsPerRow) || 0;
        rows.forEach(r => {
          for (let i = 1; i <= count; i++) {
            preview.push(`${r}-${i}`);
          }
        });
      } else {
        customRows.forEach(cr => {
          const rName = cr.rowName.trim();
          const count = Number(cr.seatCount) || 0;
          if (rName && count > 0) {
            for (let i = 1; i <= count; i++) {
              preview.push(`${rName}-${i}`);
            }
          }
        });
      }
    }
    setPreviewSeats(preview);
  }, [generatorMode, simplePrefix, simpleStart, simpleEnd, rowConfigMode, rowNamesInput, seatsPerRow, customRows]);

  // Bulk add seats with duplicate detection within the resolved scope
  const handleAddGeneratedSeats = () => {
    if (previewSeats.length === 0) return toast.error("No valid seats generated to add.");

    const currentScopeSeatTypes = tempSeatTypes.filter(st => matchesScope(st, scope.resolvedBranchId, scope.resolvedSectionId));
    const fixedTypes = currentScopeSeatTypes.filter(st => st.allocationMode === 'Fixed');
    
    const stId = selectedSeatTypeId || fixedTypes[0]?.id || currentScopeSeatTypes[0]?.id;
    if (!stId) return toast.error("Please configure a Fixed Seat Type for this section/branch before generating physical desks.");

    let addedCount = 0;
    const duplicates = [];
    const newSeatsList = [...tempSeats];

    previewSeats.forEach(name => {
      const exists = newSeatsList.some(s => 
        s.name.toLowerCase() === name.toLowerCase() && 
        s.sectionId === (scope.resolvedSectionId || undefined) &&
        s.branchId === (scope.resolvedBranchId || undefined)
      );

      if (exists) {
        duplicates.push(name);
      } else {
        newSeatsList.push({
          id: `seat-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          name,
          seatTypeId: stId,
          sectionId: scope.resolvedSectionId || undefined,
          branchId: scope.resolvedBranchId || undefined,
          isMaintenance: false,
          isUnavailable: false
        });
        addedCount++;
      }
    });

    setTempSeats(newSeatsList);
    if (addedCount > 0) toast.success(`Generated and added ${addedCount} physical seats for ${scope.scopeDisplayName}.`);
    if (duplicates.length > 0) toast(`Skipped ${duplicates.length} duplicate seat names in this section.`);
  };

  // Step Validation & Navigation
  const handleSaveAndContinue = () => {
    if (step === 1) {
      if (!tempLibraryName.trim()) return toast.error("Library Name is required.");
    }
    if (step === 2) {
      if (tempBranches.some(b => !b.name.trim())) return toast.error("All added branches must have a name.");
      if (tempSections.some(s => !s.name.trim())) return toast.error("All added sections must have a name.");
      if (tempBranches.length > 0 && tempSections.some(s => !s.branchId)) {
        return toast.error("When branches exist, every section must be assigned to a specific branch.");
      }

      // Re-resolve scope for initial downstream assignment
      const currentScope = resolveConfigurationScope({
        branches: tempBranches,
        sections: tempSections,
        selectedBranchId,
        selectedSectionId
      });

      // Stamp any unassigned initial templates with the first resolved scope
      setTempSeatTypes(prev => prev.map(st => ({
        ...st,
        branchId: st.branchId !== undefined ? st.branchId : (currentScope.resolvedBranchId || undefined),
        sectionId: st.sectionId !== undefined ? st.sectionId : (currentScope.resolvedSectionId || undefined)
      })));
      setTempShifts(prev => prev.map(sh => ({
        ...sh,
        branchId: sh.branchId !== undefined ? sh.branchId : (currentScope.resolvedBranchId || undefined),
        sectionId: sh.sectionId !== undefined ? sh.sectionId : (currentScope.resolvedSectionId || undefined)
      })));
      setTempPlans(prev => prev.map(p => ({
        ...p,
        branchId: p.branchId !== undefined ? p.branchId : (currentScope.resolvedBranchId || undefined),
        sectionId: p.sectionId !== undefined ? p.sectionId : (currentScope.resolvedSectionId || undefined)
      })));
    }
    if (step === 3) {
      if (tempSeatTypes.length === 0) return toast.error("Please configure at least one Seat Type.");
    }
    if (step === 4) {
      const fixedTypes = tempSeatTypes.filter(st => st.allocationMode === 'Fixed');
      if (fixedTypes.length > 0 && tempSeats.length === 0) {
        return toast.error("Fixed Seat Types require physical desks. Generate desks before continuing.");
      }
    }
    if (step === 5) {
      if (tempShifts.length === 0) return toast.error("Please select or add at least one Shift.");
    }
    if (step === 6) {
      if (tempPlans.length === 0) return toast.error("Please configure at least one Fee Plan.");
      for (const p of tempPlans) {
        if (!p.shiftIds || p.shiftIds.length === 0) {
          return toast.error(`Plan "${p.name}" has no shifts selected. Check at least one shift.`);
        }
        if (!p.seatTypeId) {
          return toast.error(`Plan "${p.name}" must be linked to a Seat Type.`);
        }
      }
    }
    if (step === 7) {
      if (tempDocTypes.filter(d => d.active).length === 0) {
        return toast.error("Please activate at least one admission document type.");
      }
    }

    if (step < totalSteps) {
      saveDraft(step + 1, false);
      setStep(step + 1);
    } else {
      handleFinishSetup();
    }
  };

  const handleFinishSetup = () => {
    const libId = settings.libraryId || `lib-${Date.now()}`;
    
    // Protect existing occupied physical seats from accidental deletion
    const existingOccupiedNames = students
      .filter(s => s.status === 'Active' || s.status === 'Expiring Soon')
      .map(s => s.seatNo)
      .filter(name => name && name !== 'Non-Fixed Seat' && name !== 'None');

    const mergedSeats = [...tempSeats];
    seats.forEach(s => {
      if (existingOccupiedNames.includes(s.name) && !mergedSeats.some(ms => ms.name === s.name && ms.sectionId === s.sectionId && ms.branchId === s.branchId)) {
        mergedSeats.push(s);
      }
    });

    const activeDocNames = tempDocTypes.filter(d => d.active).map(d => d.name);

    setSettings({
      ...settings,
      name: tempLibraryName,
      libraryId: libId,
      documentTypes: tempDocTypes,
      allowedDocuments: activeDocNames,
      idProofDeadlineDays: tempDocDeadlineDays,
      isSetupComplete: true
    });
    setBranches(tempBranches.map(b => ({ ...b, libraryId: libId })));
    setSections(tempSections.map(s => ({ ...s, libraryId: libId })));
    setSeatTypes(tempSeatTypes.map(st => ({ ...st, libraryId: libId })));
    setShifts(tempShifts.map(sh => ({ ...sh, libraryId: libId })));
    setSeats(mergedSeats.map(s => ({ ...s, libraryId: libId })));
    setPlans(tempPlans.map(p => ({ ...p, libraryId: libId })));

    localStorage.removeItem('wizardDraft');

    if (onClose) {
      toast.success(isEditMode ? "Setup updated successfully!" : "Setup completed! Welcome to your dashboard.");
      onClose();
    } else {
      toast.success("Setup complete! Your library is ready.");
      setTimeout(() => { window.location.reload(); }, 500);
    }
  };

  // Reusable Canonical Scope Bar for Steps 3, 4, 5, 6
  const renderScopeBar = (title, subtitle) => (
    <div style={{ marginBottom: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '8px' }}>
        <div>
          <h3 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>{title}</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', margin: '4px 0 0 0' }}>
            {subtitle}
          </p>
        </div>

        {/* Scope Indicator & Switcher */}
        <div style={{ 
          display: 'flex', alignItems: 'center', gap: '8px', background: '#f8fafc', 
          padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--border-light)', flexWrap: 'wrap' 
        }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
            SCOPE:
          </span>
          <span style={{ 
            fontSize: '12px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px',
            background: '#eff6ff', color: 'var(--brand-primary)', border: '1px solid #bfdbfe'
          }}>
            📍 {scope.scopeDisplayName}
          </span>

          {/* Branch Selector (Shown only when 2+ branches exist) */}
          {scope.showBranchSelector && (
            <select
              className="form-select"
              style={{ fontSize: '12px', padding: '3px 8px', width: 'auto' }}
              value={scope.resolvedBranchId || ''}
              onChange={e => {
                setSelectedBranchId(e.target.value);
                setSelectedSectionId('');
              }}
            >
              {scope.availableBranches.map(b => (
                <option key={b.id} value={b.id}>{b.name || 'Branch'}</option>
              ))}
            </select>
          )}

          {/* Section Selector (Shown only when 2+ sections exist in current branch/library) */}
          {scope.showSectionSelector && (
            <select
              className="form-select"
              style={{ fontSize: '12px', padding: '3px 8px', width: 'auto' }}
              value={scope.resolvedSectionId || ''}
              onChange={e => setSelectedSectionId(e.target.value)}
            >
              {scope.availableSections.map(s => (
                <option key={s.id} value={s.id}>{s.name || 'Section'}</option>
              ))}
            </select>
          )}
        </div>
      </div>
    </div>
  );

  // --- Step 1: Library Details ---
  const renderStep1 = () => (
    <div>
      <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>Step 1: Library Information</h3>
      <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '20px' }}>
        Enter your official library name and branding details. This will appear across all student receipts and dashboards.
      </p>

      <div className="form-group">
        <label className="form-label">Library Name *</label>
        <input 
          className="form-input" 
          placeholder="e.g. Accomplish Study Hub & Library" 
          value={tempLibraryName} 
          onChange={e => setTempLibraryName(e.target.value)} 
          required 
        />
      </div>

      <div style={{ padding: '16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid var(--border-light)', marginTop: '16px' }}>
        <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
          💡 Easy Non-Technical Onboarding
        </h4>
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
          You can complete the wizard with the standard suggested defaults in under 2 minutes. All configurations remain fully editable at any time from Library Settings.
        </p>
      </div>
    </div>
  );

  // --- Step 2: Branches & Sections (Hierarchy Enforcement) ---
  const renderStep2 = () => (
    <div>
      <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>Step 2: Branches & Sections</h3>
      <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '20px' }}>
        Configure multiple branches and study rooms/sections. If your library has branches, each section must belong to a specific branch. If you operate from a single location, you can create direct rooms or skip sections.
      </p>

      {/* Branches */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h4 style={{ fontSize: '14px', fontWeight: 600 }}>Branches / Physical Locations (Optional)</h4>
          <button 
            type="button" 
            className="btn btn-secondary" 
            style={{ fontSize: '12px', padding: '4px 10px' }}
            onClick={() => {
              const newB = { id: `b-${Date.now()}`, name: "", code: "", address: "", active: true };
              setTempBranches([...tempBranches, newB]);
            }}
          >
            <Plus size={14} /> Add Branch
          </button>
        </div>

        {tempBranches.length === 0 ? (
          <div style={{ padding: '14px', background: '#f8fafc', borderRadius: '8px', border: '1px dashed var(--border-light)', fontSize: '13px', color: 'var(--text-secondary)' }}>
            Single-location library (Default). Add branches only if you operate multiple physical centers.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {tempBranches.map((b) => (
              <div key={b.id} style={{ display: 'flex', gap: '10px', alignItems: 'center', background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
                <input 
                  className="form-input" 
                  placeholder="Branch Name (e.g. Branch A / Main Campus)" 
                  value={b.name} 
                  onChange={e => {
                    const val = e.target.value;
                    const autoCode = (val.trim().slice(0, 3)).toUpperCase();
                    setTempBranches(tempBranches.map(tb => tb.id === b.id ? { ...tb, name: val, code: tb.code || autoCode } : tb));
                  }} 
                  style={{ flex: 1 }}
                />
                <input 
                  className="form-input" 
                  placeholder="Code" 
                  value={b.code || ''} 
                  maxLength={4}
                  onChange={e => setTempBranches(tempBranches.map(tb => tb.id === b.id ? { ...tb, code: e.target.value.toUpperCase() } : tb))} 
                  style={{ width: '80px' }}
                />
                <input 
                  className="form-input" 
                  placeholder="Address / Area" 
                  value={b.address || ''} 
                  onChange={e => setTempBranches(tempBranches.map(tb => tb.id === b.id ? { ...tb, address: e.target.value } : tb))} 
                  style={{ flex: 1.5 }}
                />
                <button 
                  type="button" 
                  className="btn btn-ghost" 
                  style={{ color: '#ef4444', padding: '6px' }}
                  onClick={() => {
                    const remaining = tempBranches.filter(tb => tb.id !== b.id);
                    setTempBranches(remaining);
                    // Reassign or clean sections referencing the deleted branch
                    if (remaining.length > 0) {
                      setTempSections(tempSections.map(s => s.branchId === b.id ? { ...s, branchId: remaining[0].id } : s));
                    } else {
                      setTempSections(tempSections.map(s => ({ ...s, branchId: undefined })));
                    }
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sections */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h4 style={{ fontSize: '14px', fontWeight: 600 }}>Sections / Study Rooms (Optional)</h4>
          <button 
            type="button" 
            className="btn btn-secondary" 
            style={{ fontSize: '12px', padding: '4px 10px' }}
            onClick={() => {
              const defaultBranchId = tempBranches.length > 0 ? (scope.resolvedBranchId || tempBranches[0].id) : undefined;
              setTempSections([...tempSections, {
                id: `sec-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
                name: "",
                branchId: defaultBranchId,
                active: true
              }]);
            }}
          >
            <Plus size={14} /> Add Section
          </button>
        </div>

        {tempSections.length === 0 ? (
          <div style={{ padding: '14px', background: '#f8fafc', borderRadius: '8px', border: '1px dashed var(--border-light)', fontSize: '13px', color: 'var(--text-secondary)' }}>
            One common study hall. Add sections (e.g., "Section A1", "Discussion Hall") if you separate rooms.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {tempSections.map(sec => (
              <div key={sec.id} style={{ display: 'flex', gap: '10px', alignItems: 'center', background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
                <input 
                  className="form-input" 
                  placeholder="Section Name (e.g. Quiet Study Room, Section A1)" 
                  value={sec.name} 
                  onChange={e => setTempSections(tempSections.map(s => s.id === sec.id ? { ...s, name: e.target.value } : s))}
                  style={{ flex: 1 }}
                />
                
                {/* Branch ownership selector for section (Shown when 2+ branches exist) */}
                {tempBranches.length > 1 && (
                  <select 
                    className="form-select" 
                    value={sec.branchId || tempBranches[0]?.id} 
                    onChange={e => setTempSections(tempSections.map(s => s.id === sec.id ? { ...s, branchId: e.target.value } : s))}
                    style={{ width: '200px' }}
                  >
                    {tempBranches.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.name || 'Branch'}
                      </option>
                    ))}
                  </select>
                )}

                <button 
                  type="button" 
                  className="btn btn-ghost" 
                  style={{ color: '#ef4444', padding: '6px' }}
                  onClick={() => setTempSections(tempSections.filter(s => s.id !== sec.id))}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // --- Step 3: Seat Types (Scope-Aware) ---
  const renderStep3 = () => {
    const currentScopeSeatTypes = tempSeatTypes.filter(st => matchesScope(st, scope.resolvedBranchId, scope.resolvedSectionId));

    return (
      <div>
        {renderScopeBar(
          "Step 3: Seat Types (Fixed vs Non-Fixed)",
          "Configure seat types for the current scope. Fixed Seat Types allocate designated physical desks. Non-Fixed Seat Types manage capacity for open seating."
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {currentScopeSeatTypes.length === 0 ? (
            <div style={{ padding: '14px', background: '#f8fafc', borderRadius: '8px', border: '1px dashed var(--border-light)', fontSize: '13px', color: 'var(--text-secondary)' }}>
              No Seat Types configured for {scope.scopeDisplayName}. Click "+ Add Seat Type" below to configure.
            </div>
          ) : (
            currentScopeSeatTypes.map(st => (
              <div key={st.id} style={{ background: '#f8fafc', border: '1px solid var(--border-light)', borderRadius: '8px', padding: '16px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 1.5fr auto', gap: '12px', alignItems: 'flex-end' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '12px' }}>Seat Type Name</label>
                    <input 
                      className="form-input" 
                      value={st.name} 
                      onChange={e => setTempSeatTypes(tempSeatTypes.map(item => item.id === st.id ? { ...item, name: e.target.value } : item))} 
                      placeholder="e.g. Reserved Fixed Desk"
                    />
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '12px' }}>Allocation Mode</label>
                    <select 
                      className="form-select" 
                      value={st.allocationMode || 'Fixed'} 
                      onChange={e => {
                        const mode = e.target.value;
                        setTempSeatTypes(tempSeatTypes.map(item => item.id === st.id ? {
                          ...item,
                          allocationMode: mode,
                          capacityMode: mode === 'Non-Fixed' ? 'Unlimited' : null,
                          maximumStudentsAllowed: null
                        } : item));
                      }}
                    >
                      <option value="Fixed">Fixed (Physical Desks)</option>
                      <option value="Non-Fixed">Non-Fixed (Capacity)</option>
                    </select>
                  </div>

                  {st.allocationMode === 'Non-Fixed' ? (
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: '12px' }}>Capacity Limit</label>
                      <select 
                        className="form-select" 
                        value={st.capacityMode || 'Unlimited'} 
                        onChange={e => {
                          const cMode = e.target.value;
                          setTempSeatTypes(tempSeatTypes.map(item => item.id === st.id ? {
                            ...item,
                            capacityMode: cMode,
                            maximumStudentsAllowed: cMode === 'Limited' ? 50 : null
                          } : item));
                        }}
                      >
                        <option value="Unlimited">Unlimited</option>
                        <option value="Limited">Limited Max</option>
                      </select>
                    </div>
                  ) : (
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', alignSelf: 'center', paddingBottom: '8px' }}>
                      Requires Physical Desks (Step 4)
                    </div>
                  )}

                  <button 
                    type="button" 
                    className="btn btn-ghost" 
                    style={{ color: '#ef4444', padding: '6px' }}
                    onClick={() => setTempSeatTypes(tempSeatTypes.filter(item => item.id !== st.id))}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                {st.allocationMode === 'Non-Fixed' && st.capacityMode === 'Limited' && (
                  <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 600 }}>Max Students Allowed:</label>
                    <NumericInput 
                      className="form-input" 
                      style={{ width: '100px' }} 
                      value={st.maximumStudentsAllowed || 50} 
                      onChange={e => {
                        const val = Number(e.target.value);
                        setTempSeatTypes(tempSeatTypes.map(item => item.id === st.id ? { ...item, maximumStudentsAllowed: val } : item));
                      }} 
                    />
                  </div>
                )}
              </div>
            ))
          )}

          <button 
            type="button" 
            className="btn btn-secondary" 
            style={{ alignSelf: 'flex-start' }}
            onClick={() => {
              setTempSeatTypes([...tempSeatTypes, {
                id: `st-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
                name: "",
                allocationMode: 'Fixed',
                capacityMode: null,
                maximumStudentsAllowed: null,
                branchId: scope.resolvedBranchId || undefined,
                sectionId: scope.resolvedSectionId || undefined
              }]);
            }}
          >
            <Plus size={14} /> Add Seat Type
          </button>
        </div>
      </div>
    );
  };

  // --- Step 4: Seat Map & Physical Desks (Scope-Aware) ---
  const renderStep4 = () => {
    const currentScopeSeatTypes = tempSeatTypes.filter(st => matchesScope(st, scope.resolvedBranchId, scope.resolvedSectionId));
    const fixedSeatTypes = currentScopeSeatTypes.filter(st => st.allocationMode === 'Fixed');
    const currentSeats = tempSeats.filter(s => matchesScope(s, scope.resolvedBranchId, scope.resolvedSectionId));

    return (
      <div>
        {renderScopeBar(
          "Step 4: Seat Map & Physical Desks",
          "Generate physical desk numbers for Fixed Seat Types in the active scope. Sequential (1 to 50) and row-based (A-1, B-1) generation supported."
        )}

        {fixedSeatTypes.length === 0 ? (
          <div style={{ padding: '16px', background: '#ecfdf5', borderRadius: '8px', border: '1px solid #a7f3d0', color: '#065f46' }}>
            All seat types configured for {scope.scopeDisplayName} are Non-Fixed. No physical desk generation required. You can proceed to the next step.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ background: '#f8fafc', border: '1px solid var(--border-light)', borderRadius: '8px', padding: '16px' }}>
              <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                  <input type="radio" checked={generatorMode === 'simple'} onChange={() => setGeneratorMode('simple')} />
                  <span>Sequential Range (e.g. 1 to 50)</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                  <input type="radio" checked={generatorMode === 'row'} onChange={() => setGeneratorMode('row')} />
                  <span>Row-Based (e.g. A-1, B-1)</span>
                </label>
              </div>

              {generatorMode === 'simple' ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1.5fr 1fr', gap: '12px', alignItems: 'flex-end' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '11px' }}>Prefix (Optional)</label>
                    <input className="form-input" placeholder="e.g. D-" value={simplePrefix} onChange={e => setSimplePrefix(e.target.value)} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '11px' }}>Start Number</label>
                    <NumericInput className="form-input" value={simpleStart} onChange={e => setSimpleStart(Number(e.target.value))} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '11px' }}>End Number</label>
                    <NumericInput className="form-input" value={simpleEnd} onChange={e => setSimpleEnd(Number(e.target.value))} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '11px' }}>Seat Type</label>
                    <select className="form-select" value={selectedSeatTypeId || fixedSeatTypes[0]?.id} onChange={e => setSelectedSeatTypeId(e.target.value)}>
                      {fixedSeatTypes.map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
                    </select>
                  </div>
                  <button type="button" className="btn btn-primary" onClick={handleAddGeneratedSeats}>
                    <Plus size={14} /> Add Desks
                  </button>
                </div>
              ) : (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1.5fr 1fr', gap: '12px', alignItems: 'flex-end', marginBottom: '12px' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: '11px' }}>Row Names (comma-separated)</label>
                      <input className="form-input" value={rowNamesInput} onChange={e => setRowNamesInput(e.target.value)} placeholder="A, B, C, D" />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: '11px' }}>Seats Per Row</label>
                      <NumericInput className="form-input" value={seatsPerRow} onChange={e => setSeatsPerRow(Number(e.target.value))} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: '11px' }}>Seat Type</label>
                      <select className="form-select" value={selectedSeatTypeId || fixedSeatTypes[0]?.id} onChange={e => setSelectedSeatTypeId(e.target.value)}>
                        {fixedSeatTypes.map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
                      </select>
                    </div>
                    <button type="button" className="btn btn-primary" onClick={handleAddGeneratedSeats}>
                      <Plus size={14} /> Add Desks
                    </button>
                  </div>
                </div>
              )}

              {/* Preview */}
              {previewSeats.length > 0 && (
                <div style={{ marginTop: '14px', padding: '10px', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    GENERATOR PREVIEW ({previewSeats.length} DESKS):
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', maxHeight: '70px', overflowY: 'auto' }}>
                    {previewSeats.slice(0, 30).map((name, i) => (
                      <span key={i} style={{ fontSize: '11px', background: '#eff6ff', color: '#1d4ed8', padding: '2px 6px', borderRadius: '4px' }}>
                        {name}
                      </span>
                    ))}
                    {previewSeats.length > 30 && <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>+{previewSeats.length - 30} more</span>}
                  </div>
                </div>
              )}
            </div>

            {/* Existing Seats List */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <h4 style={{ fontSize: '13px', fontWeight: 600 }}>
                  Configured Desks in {scope.scopeDisplayName} ({currentSeats.length} Total)
                </h4>
                {currentSeats.length > 0 && (
                  <button 
                    type="button" 
                    className="btn btn-ghost" 
                    style={{ fontSize: '12px', color: '#ef4444' }} 
                    onClick={() => {
                      setTempSeats(tempSeats.filter(s => !matchesScope(s, scope.resolvedBranchId, scope.resolvedSectionId)));
                      toast.success(`Cleared desks in ${scope.scopeDisplayName}`);
                    }}
                  >
                    Clear Section Desks
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', maxHeight: '180px', overflowY: 'auto', padding: '10px', background: '#f8fafc', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
                {currentSeats.length === 0 ? (
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>No desks configured in this section yet.</span>
                ) : (
                  currentSeats.map(s => (
                    <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#fff', border: '1px solid #cbd5e1', padding: '3px 8px', borderRadius: '4px', fontSize: '12px' }}>
                      <span>{s.name}</span>
                      <button type="button" onClick={() => setTempSeats(tempSeats.filter(ts => ts.id !== s.id))} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 0 }}>
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // --- Step 5: Operating Shifts (Scope-Aware) ---
  const renderStep5 = () => {
    const currentShifts = tempShifts.filter(sh => matchesScope(sh, scope.resolvedBranchId, scope.resolvedSectionId));

    return (
      <div>
        {renderScopeBar(
          "Step 5: Operating Shifts",
          "Shifts define WHEN students can use the library for the active scope (e.g. Full Day, Morning, Evening, Weekend)."
        )}

        {/* Template Checkboxes */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginBottom: '20px' }}>
          {INITIAL_SHIFT_TEMPLATES.map(tpl => {
            const isSelected = currentShifts.some(sh => sh.name.toLowerCase() === tpl.name.toLowerCase());
            return (
              <div 
                key={tpl.name}
                onClick={() => {
                  if (isSelected) {
                    setTempShifts(tempShifts.filter(sh => !(matchesScope(sh, scope.resolvedBranchId, scope.resolvedSectionId) && sh.name.toLowerCase() === tpl.name.toLowerCase())));
                  } else {
                    setTempShifts([...tempShifts, {
                      id: `sh-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
                      name: tpl.name,
                      startTime: tpl.startTime,
                      endTime: tpl.endTime,
                      daysOfWeek: tpl.daysOfWeek,
                      branchId: scope.resolvedBranchId || undefined,
                      sectionId: scope.resolvedSectionId || undefined,
                      active: true
                    }]);
                  }
                }}
                style={{
                  padding: '14px', borderRadius: '8px', cursor: 'pointer',
                  border: isSelected ? '2px solid var(--brand-primary)' : '1px solid var(--border-light)',
                  background: isSelected ? '#eff6ff' : '#fff'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: '14px' }}>{tpl.name}</strong>
                  <input type="checkbox" checked={isSelected} readOnly />
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  {tpl.startTime} – {tpl.endTime}
                </div>
              </div>
            );
          })}
        </div>

        {/* Selected Shifts List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
          {currentShifts.map(sh => (
            <div key={sh.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
              <div>
                <strong>{sh.name}</strong>
              </div>
              <button type="button" className="btn btn-ghost" style={{ color: '#ef4444', padding: '6px' }} onClick={() => setTempShifts(tempShifts.filter(s => s.id !== sh.id))}>
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>

        {/* Add Custom Shift Button */}
        {!showCustomShiftForm ? (
          <button type="button" className="btn btn-secondary" onClick={() => setShowCustomShiftForm(true)}>
            <Plus size={14} /> Add Custom Shift
          </button>
        ) : (
          <div style={{ background: '#f8fafc', border: '1px solid var(--border-light)', padding: '16px', borderRadius: '8px' }}>
            <h4 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '10px' }}>New Custom Shift for {scope.scopeDisplayName}</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '10px', marginBottom: '10px' }}>
              <input className="form-input" placeholder="Shift Name (e.g. Night Owl)" value={customShiftName} onChange={e => setCustomShiftName(e.target.value)} />
              <input type="time" className="form-input" value={customShiftStart} onChange={e => setCustomShiftStart(e.target.value)} />
              <input type="time" className="form-input" value={customShiftEnd} onChange={e => setCustomShiftEnd(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                type="button" 
                className="btn btn-primary"
                onClick={() => {
                  if (!customShiftName.trim()) return toast.error("Shift name required.");
                  setTempShifts([...tempShifts, {
                    id: `sh-${Date.now()}`,
                    name: customShiftName.trim(),
                    startTime: customShiftStart,
                    endTime: customShiftEnd,
                    daysOfWeek: customShiftDays,
                    branchId: scope.resolvedBranchId || undefined,
                    sectionId: scope.resolvedSectionId || undefined,
                    active: true
                  }]);
                  setCustomShiftName('');
                  setShowCustomShiftForm(false);
                }}
              >
                Save Custom Shift
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setShowCustomShiftForm(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // --- Step 6: Fee Plans (Scope-Aware) ---
  const renderStep6 = () => {
    const currentScopeSeatTypes = tempSeatTypes.filter(st => matchesScope(st, scope.resolvedBranchId, scope.resolvedSectionId));
    const currentScopeShifts = tempShifts.filter(sh => matchesScope(sh, scope.resolvedBranchId, scope.resolvedSectionId));
    const currentPlans = tempPlans.filter(p => matchesScope(p, scope.resolvedBranchId, scope.resolvedSectionId));

    return (
      <div>
        {renderScopeBar(
          "Step 6: Fee Plans & Duration Pricing",
          "Fee plans define WHAT the student pays for the active scope. Plans link compatible Seat Types and Shifts with duration pricing."
        )}

        {/* Plan Template Suggestions */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
          {INITIAL_PLAN_TEMPLATES.map(tpl => {
            const exists = currentPlans.some(p => p.name.toLowerCase() === tpl.name.toLowerCase());
            return (
              <button
                key={tpl.name}
                type="button"
                className={exists ? "btn btn-primary" : "btn btn-ghost"}
                style={{ fontSize: '12px', border: '1px solid var(--border-light)' }}
                onClick={() => {
                  if (!exists) {
                    setTempPlans([...tempPlans, {
                      id: `pl-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
                      name: tpl.name,
                      seatTypeId: currentScopeSeatTypes[0]?.id || tempSeatTypes[0]?.id,
                      shiftIds: currentScopeShifts.map(s => s.id),
                      branchId: scope.resolvedBranchId || undefined,
                      sectionId: scope.resolvedSectionId || undefined,
                      durationPricing: [
                        { durationMonths: 1, basePrice: 1500, discountType: 'None', discountValue: 0 },
                        { durationMonths: 3, basePrice: 4500, discountType: 'Percentage', discountValue: 5 }
                      ],
                      active: true
                    }]);
                  }
                }}
              >
                + Suggest {tpl.name}
              </button>
            );
          })}
        </div>

        {/* Configured Plans Editor */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {currentPlans.length === 0 ? (
            <div style={{ padding: '14px', background: '#f8fafc', borderRadius: '8px', border: '1px dashed var(--border-light)', fontSize: '13px', color: 'var(--text-secondary)' }}>
              No Fee Plans configured for {scope.scopeDisplayName}. Click "+ Add Custom Plan" below.
            </div>
          ) : (
            currentPlans.map(p => (
              <div key={p.id} style={{ background: '#f8fafc', border: '1px solid var(--border-light)', borderRadius: '8px', padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: '11px' }}>Plan Name</label>
                      <input 
                        className="form-input" 
                        value={p.name} 
                        onChange={e => setTempPlans(tempPlans.map(item => item.id === p.id ? { ...item, name: e.target.value } : item))} 
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: '11px' }}>Seat Type</label>
                      <select 
                        className="form-select" 
                        value={p.seatTypeId || ''} 
                        onChange={e => setTempPlans(tempPlans.map(item => item.id === p.id ? { ...item, seatTypeId: e.target.value } : item))}
                      >
                        {currentScopeSeatTypes.map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <button type="button" className="btn btn-ghost" style={{ color: '#ef4444', marginLeft: '12px' }} onClick={() => setTempPlans(tempPlans.filter(item => item.id !== p.id))}>
                    <Trash2 size={16} />
                  </button>
                </div>

                {/* Applicable Shifts */}
                <div style={{ marginBottom: '12px' }}>
                  <label className="form-label" style={{ fontSize: '11px' }}>Applicable Shifts (Multi-select)</label>
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    {currentScopeShifts.map(sh => {
                      const checked = p.shiftIds?.includes(sh.id);
                      return (
                        <label key={sh.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
                          <input 
                            type="checkbox" 
                            checked={checked} 
                            onChange={() => {
                              const newShiftIds = checked 
                                ? p.shiftIds.filter(id => id !== sh.id)
                                : [...(p.shiftIds || []), sh.id];
                              setTempPlans(tempPlans.map(item => item.id === p.id ? { ...item, shiftIds: newShiftIds } : item));
                            }}
                          />
                          <span>{sh.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Duration Pricing */}
                <div>
                  <label className="form-label" style={{ fontSize: '11px' }}>Pricing & Discounts per Duration</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {(p.durationPricing || []).map((dp, idx) => (
                      <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 1.5fr 1.5fr auto', gap: '8px', alignItems: 'center', background: '#fff', padding: '6px 12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                        <span style={{ fontSize: '12px', fontWeight: 600 }}>{dp.durationMonths} Mo</span>
                        <NumericInput 
                          className="form-input" 
                          style={{ padding: '4px 8px', fontSize: '12px' }} 
                          value={dp.basePrice} 
                          onChange={e => {
                            const val = Number(e.target.value);
                            const updated = p.durationPricing.map((item, i) => i === idx ? { ...item, basePrice: val } : item);
                            setTempPlans(tempPlans.map(item => item.id === p.id ? { ...item, durationPricing: updated } : item));
                          }} 
                        />
                        <select 
                          className="form-select" 
                          style={{ padding: '4px 8px', fontSize: '12px' }}
                          value={dp.discountType || 'None'} 
                          onChange={e => {
                            const dType = e.target.value;
                            const updated = p.durationPricing.map((item, i) => i === idx ? { ...item, discountType: dType } : item);
                            setTempPlans(tempPlans.map(item => item.id === p.id ? { ...item, durationPricing: updated } : item));
                          }} 
                        >
                          <option value="None">No Discount</option>
                          <option value="Percentage">% Discount</option>
                          <option value="Fixed">₹ Discount</option>
                        </select>
                        <NumericInput 
                          className="form-input" 
                          style={{ padding: '4px 8px', fontSize: '12px' }} 
                          value={dp.discountValue || 0} 
                          onChange={e => {
                            const val = Number(e.target.value);
                            const updated = p.durationPricing.map((item, i) => i === idx ? { ...item, discountValue: val } : item);
                            setTempPlans(tempPlans.map(item => item.id === p.id ? { ...item, durationPricing: updated } : item));
                          }} 
                        />
                        <button type="button" className="btn btn-ghost" style={{ color: '#ef4444', padding: '2px' }} onClick={() => {
                          const updated = p.durationPricing.filter((_, i) => i !== idx);
                          setTempPlans(tempPlans.map(item => item.id === p.id ? { ...item, durationPricing: updated } : item));
                        }}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: '6px', marginTop: '6px', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>+ Add Duration:</span>
                      {STANDARD_DURATIONS.filter(dur => !p.durationPricing?.some(dp => dp.durationMonths === dur)).map(dur => (
                        <button
                          type="button"
                          key={dur}
                          className="btn btn-ghost"
                          style={{ fontSize: '11px', padding: '2px 8px', border: '1px solid #cbd5e1' }}
                          onClick={() => {
                            const newPricing = [...(p.durationPricing || []), {
                              durationMonths: dur,
                              basePrice: dur * 1500,
                              discountType: dur >= 3 ? 'Percentage' : 'None',
                              discountValue: dur >= 3 ? 5 : 0
                            }].sort((a, b) => a.durationMonths - b.durationMonths);
                            setTempPlans(tempPlans.map(item => item.id === p.id ? { ...item, durationPricing: newPricing } : item));
                          }}
                        >
                          +{dur} Mo
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}

          <button 
            type="button" 
            className="btn btn-secondary" 
            style={{ alignSelf: 'flex-start' }}
            onClick={() => {
              setTempPlans([...tempPlans, {
                id: `pl-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
                name: "New Fee Plan",
                seatTypeId: currentScopeSeatTypes[0]?.id || tempSeatTypes[0]?.id,
                shiftIds: currentScopeShifts.map(s => s.id),
                branchId: scope.resolvedBranchId || undefined,
                sectionId: scope.resolvedSectionId || undefined,
                durationPricing: [{ durationMonths: 1, basePrice: 1500, discountType: 'None', discountValue: 0 }],
                active: true
              }]);
            }}
          >
            <Plus size={14} /> Add Custom Plan
          </button>
        </div>
      </div>
    );
  };

  // --- Step 7: Admission Documents ---
  const renderStep7 = () => {
    return (
      <div>
        <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>Step 7: Admission Document Settings</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '20px' }}>
          Configure required ID proofs and verification policies. You can set individual requirements (Required at Admission, Can Be Submitted Later, or Not Required).
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
          {tempDocTypes.map(doc => (
            <div key={doc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <input 
                  type="checkbox" 
                  checked={doc.active} 
                  onChange={() => {
                    setTempDocTypes(tempDocTypes.map(d => d.id === doc.id ? { ...d, active: !d.active } : d));
                  }} 
                  style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                />
                <span style={{ fontWeight: 600, fontSize: '13px' }}>{doc.name}</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <select 
                  className="form-select" 
                  style={{ fontSize: '12px', padding: '4px 8px' }}
                  value={doc.requirement} 
                  onChange={e => {
                    setTempDocTypes(tempDocTypes.map(d => d.id === doc.id ? { ...d, requirement: e.target.value } : d));
                  }}
                  disabled={!doc.active}
                >
                  <option value="Required">Required at Admission</option>
                  <option value="Can Be Submitted Later">Can Be Submitted Later</option>
                  <option value="Not Required">Not Required</option>
                </select>

                {doc.id.startsWith('custom-') && (
                  <button type="button" className="btn btn-ghost" style={{ color: '#ef4444', padding: '4px' }} onClick={() => setTempDocTypes(tempDocTypes.filter(d => d.id !== doc.id))}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Add Custom Document */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', background: '#fff', border: '1px solid var(--border-light)', padding: '14px', borderRadius: '8px', marginBottom: '16px' }}>
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: '11px' }}>Custom Document Name</label>
            <input className="form-input" placeholder="e.g. College Bonafide, Police Clearance" value={newCustomDocName} onChange={e => setNewCustomDocName(e.target.value)} />
          </div>
          <div className="form-group" style={{ width: '200px', marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: '11px' }}>Requirement Rule</label>
            <select className="form-select" value={newCustomDocReq} onChange={e => setNewCustomDocReq(e.target.value)}>
              <option value="Required">Required at Admission</option>
              <option value="Can Be Submitted Later">Can Be Submitted Later</option>
              <option value="Not Required">Not Required</option>
            </select>
          </div>
          <button 
            type="button" 
            className="btn btn-secondary"
            onClick={() => {
              if (!newCustomDocName.trim()) return toast.error("Document name required.");
              setTempDocTypes([...tempDocTypes, {
                id: `custom-${Date.now()}`,
                name: newCustomDocName.trim(),
                requirement: newCustomDocReq,
                active: true
              }]);
              setNewCustomDocName('');
              toast.success("Document type added.");
            }}
          >
            <Plus size={14} /> Add
          </button>
        </div>

        {/* Deadline Days */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: '#f8fafc', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
          <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Deadline for deferred documents (days):</label>
          <NumericInput 
            className="form-input" 
            style={{ width: '90px' }} 
            value={tempDocDeadlineDays} 
            onChange={e => setTempDocDeadlineDays(Number(e.target.value))} 
          />
        </div>
      </div>
    );
  };

  // --- Step 8: Final Review & Finish Setup ---
  const renderStep8 = () => {
    return (
      <div>
        <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>Step 8: Final Review & Confirmation</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '20px' }}>
          Review your library hierarchy and configurations before finalizing. All records remain fully editable post-setup.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginBottom: '20px' }}>
          <div style={{ background: '#f8fafc', border: '1px solid var(--border-light)', borderRadius: '8px', padding: '14px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>LIBRARY & LOCATIONS</div>
            <div style={{ fontSize: '16px', fontWeight: 700, marginTop: '4px' }}>{tempLibraryName}</div>
            <div style={{ fontSize: '12px', color: 'var(--brand-primary)', marginTop: '2px' }}>
              {tempBranches.length > 0 ? `${tempBranches.length} Branches` : 'Single Location'} • {tempSections.length} Sections
            </div>
          </div>

          <div style={{ background: '#f8fafc', border: '1px solid var(--border-light)', borderRadius: '8px', padding: '14px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>PHYSICAL SEATS</div>
            <div style={{ fontSize: '16px', fontWeight: 700, marginTop: '4px' }}>{tempSeats.length} Desks</div>
            <div style={{ fontSize: '12px', color: 'var(--brand-primary)', marginTop: '2px' }}>
              {tempSeatTypes.map(st => st.name).filter(Boolean).join(', ') || 'Configured'}
            </div>
          </div>

          <div style={{ background: '#f8fafc', border: '1px solid var(--border-light)', borderRadius: '8px', padding: '14px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>OPERATING SHIFTS</div>
            <div style={{ fontSize: '16px', fontWeight: 700, marginTop: '4px' }}>{tempShifts.length} Shifts</div>
            <div style={{ fontSize: '12px', color: 'var(--brand-primary)', marginTop: '2px' }}>
              {tempShifts.map(sh => sh.name).filter(Boolean).join(', ')}
            </div>
          </div>

          <div style={{ background: '#f8fafc', border: '1px solid var(--border-light)', borderRadius: '8px', padding: '14px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>FEE PLANS</div>
            <div style={{ fontSize: '16px', fontWeight: 700, marginTop: '4px' }}>{tempPlans.length} Active Plans</div>
            <div style={{ fontSize: '12px', color: 'var(--brand-primary)', marginTop: '2px' }}>
              {tempPlans.map(p => p.name).filter(Boolean).join(', ')}
            </div>
          </div>
        </div>

        <div style={{ padding: '12px 16px', background: '#ecfdf5', borderRadius: '8px', border: '1px solid #a7f3d0', display: 'flex', alignItems: 'center', gap: '8px', color: '#065f46' }}>
          <CheckCircle size={18} />
          <span style={{ fontSize: '13px' }}>
            {isEditMode 
              ? "Saving will update your configuration without altering active students, seat allocations, or payment history."
              : "Finish Setup will complete initial onboarding and unlock your administrative dashboard."}
          </span>
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, overflowY: 'auto', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      <header style={{ padding: '16px 32px', background: '#fff', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Building2 size={24} color="var(--brand-primary)" />
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>Library Setup Wizard</h1>
          {isEditMode && (
            <span style={{ fontSize: '12px', background: '#dbeafe', color: '#1d4ed8', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
              Edit / Resume Mode
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Step {step} of {totalSteps}
          </span>
          {onClose && (
            <button 
              type="button" 
              className="btn btn-ghost" 
              onClick={onClose}
              style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <X size={16} /> Exit Setup
            </button>
          )}
        </div>
      </header>

      <main style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '32px 16px' }}>
        <motion.div 
          initial={{ opacity: 0, y: 15 }} 
          animate={{ opacity: 1, y: 0 }}
          style={{ background: '#fff', width: '100%', maxWidth: '920px', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.06)', border: '1px solid var(--border-light)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        >
          {/* Progress Bar */}
          <div style={{ display: 'flex', background: '#f8fafc', padding: '16px 24px', borderBottom: '1px solid var(--border-light)', justifyContent: 'space-between', overflowX: 'auto' }}>
            {[
              { s: 1, label: "Library" },
              { s: 2, label: "Branches" },
              { s: 3, label: "Seat Types" },
              { s: 4, label: "Seat Map" },
              { s: 5, label: "Shifts" },
              { s: 6, label: "Fee Plans" },
              { s: 7, label: "Documents" },
              { s: 8, label: "Review" }
            ].map(item => (
              <div key={item.s} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', minWidth: '60px' }}>
                <div style={{ 
                  width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: step >= item.s ? 'var(--brand-primary)' : '#cbd5e1',
                  color: '#fff', fontWeight: 600, fontSize: '12px'
                }}>
                  {item.s}
                </div>
                <span style={{ fontSize: '11px', fontWeight: step === item.s ? 700 : 500, color: step === item.s ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                  {item.label}
                </span>
              </div>
            ))}
          </div>

          <div style={{ padding: '32px', flex: 1 }}>
            {step === 1 && renderStep1()}
            {step === 2 && renderStep2()}
            {step === 3 && renderStep3()}
            {step === 4 && renderStep4()}
            {step === 5 && renderStep5()}
            {step === 6 && renderStep6()}
            {step === 7 && renderStep7()}
            {step === 8 && renderStep8()}
          </div>

          {/* Footer Actions */}
          <div style={{ padding: '16px 32px', background: '#f8fafc', borderTop: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button 
              type="button" 
              className="btn btn-ghost" 
              disabled={step === 1}
              onClick={() => step > 1 && setStep(step - 1)}
            >
              Back
            </button>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={() => saveDraft(step, true)}
              >
                Save Progress
              </button>
              <button 
                type="button" 
                className="btn btn-primary" 
                onClick={handleSaveAndContinue}
              >
                {step === totalSteps ? 'Finish Setup' : 'Save & Continue'}
              </button>
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  );
};
