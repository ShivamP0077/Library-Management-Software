const fs = require('fs');
const path = require('path');

const newSetupWizard = `import React, { useState, useEffect } from 'react';
import { useLibrary } from '../context/LibraryContext';
import { motion, AnimatePresence } from 'framer-motion';
import { Building2, Grid, Clock, CheckCircle, Plus, Trash2, ShieldAlert, Copy, ChevronRight, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { NumericInput } from './NumericInput';

const BlockSeatGenerator = ({ sectionId, sectionName, tempSeats, setTempSeats, tempSeatTypes }) => {
  const [prefix, setPrefix] = useState('S');
  const [startNum, setStartNum] = useState(1);
  const [endNum, setEndNum] = useState(20);
  
  // Only show Fixed seat types for this context
  const sectionSeatTypes = tempSeatTypes.filter(st => 
    (st.sectionId === sectionId || (!st.sectionId && !sectionId)) && st.allocationMode === 'Fixed'
  );
  
  const [selectedTypeId, setSelectedTypeId] = useState(sectionSeatTypes[0]?.id || '');

  useEffect(() => {
    if (!selectedTypeId && sectionSeatTypes.length > 0) {
      setSelectedTypeId(sectionSeatTypes[0].id);
    }
  }, [sectionSeatTypes, selectedTypeId]);

  const currentSeats = tempSeats.filter(s => s.sectionId === sectionId || (!s.sectionId && !sectionId));

  const handleBulkAdd = () => {
    if (!selectedTypeId) return toast.error('Create a Fixed seat type first.');
    if (startNum > endNum) return toast.error('Start number must be less than or equal to End number.');
    
    let addedCount = 0;
    const newSeats = [];
    
    const seatTypeObj = tempSeatTypes.find(st => st.id === selectedTypeId);
    if (!seatTypeObj) return;

    for (let i = startNum; i <= endNum; i++) {
      const seatName = \`\${prefix}\${i}\`;
      if (!currentSeats.find(s => s.name === seatName)) {
        newSeats.push({
          id: \`seat-\${Date.now()}-\${Math.random().toString(36).substr(2, 5)}\`,
          name: seatName, 
          seatTypeId: selectedTypeId, 
          branchId: seatTypeObj.branchId,
          sectionId: seatTypeObj.sectionId,
          isMaintenance: false, 
          isUnavailable: false
        });
        addedCount++;
      }
    }
    setTempSeats([...tempSeats, ...newSeats]);
    toast.success(\`Added \${addedCount} seats\`);
  };

  return (
    <div style={{ border: '1px solid var(--border-light)', padding: '16px', borderRadius: '8px', marginBottom: '12px', background: 'var(--bg-surface)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h5 style={{ fontWeight: 600 }}>{sectionName || "General Seats"}</h5>
        <span style={{ fontSize: '12px', background: '#e0f2fe', color: '#0284c7', padding: '4px 8px', borderRadius: '4px' }}>
          Total Seats: {currentSeats.length}
        </span>
      </div>
      
      {sectionSeatTypes.length === 0 ? (
        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>No Fixed seat types configured for this scope. Go back to Step 3.</div>
      ) : (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label" style={{ fontSize: '12px' }}>Prefix</label><input className="form-input" style={{ width: '80px' }} value={prefix} onChange={e => setPrefix(e.target.value)} /></div>
          <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label" style={{ fontSize: '12px' }}>Start</label><NumericInput className="form-input" style={{ width: '80px' }} value={startNum} onChange={e => setStartNum(Number(e.target.value))} /></div>
          <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label" style={{ fontSize: '12px' }}>End</label><NumericInput className="form-input" style={{ width: '80px' }} value={endNum} onChange={e => setEndNum(Number(e.target.value))} /></div>
          <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
            <label className="form-label" style={{ fontSize: '12px' }}>Seat Type</label>
            <select className="form-select" value={selectedTypeId} onChange={e => setSelectedTypeId(e.target.value)}>
              {sectionSeatTypes.map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
            </select>
          </div>
          <button className="btn btn-secondary" onClick={handleBulkAdd}><Plus size={14} /> Bulk Add</button>
        </div>
      )}
      
      {currentSeats.length > 0 && (
         <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '16px', maxHeight: '120px', overflowY: 'auto', padding: '8px', background: '#f8fafc', borderRadius: '4px' }}>
            {currentSeats.map(s => (
               <div key={s.id} style={{ fontSize: '11px', background: '#fff', border: '1px solid var(--border-light)', padding: '2px 6px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {s.name}
                  <Trash2 size={10} style={{ cursor: 'pointer', color: 'var(--danger-color)' }} onClick={() => setTempSeats(tempSeats.filter(ts => ts.id !== s.id))} />
               </div>
            ))}
         </div>
      )}
    </div>
  );
};

export const SetupWizard = () => {
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

  // Draft Storage Management
  const getDraft = () => {
    try {
      const draftStr = localStorage.getItem('wizardDraft');
      if (draftStr) return JSON.parse(draftStr);
    } catch(e) {}
    return null;
  };
  
  const [draft, setDraft] = useState(getDraft());

  const [step, setStep] = useState(draft?.step || 1);
  const totalSteps = 7;

  // State
  const [tempLibraryName, setTempLibraryName] = useState(draft?.tempLibraryName ?? (settings.name || ''));
  const [tempBranches, setTempBranches] = useState(draft?.tempBranches ?? [...branches]);
  const [tempSections, setTempSections] = useState(draft?.tempSections ?? [...sections]);
  const [tempSeatTypes, setTempSeatTypes] = useState(draft?.tempSeatTypes ?? [...seatTypes]);
  const [tempSeats, setTempSeats] = useState(draft?.tempSeats ?? [...seats]);
  const [tempShifts, setTempShifts] = useState(draft?.tempShifts ?? [...shifts]);
  const [tempPlans, setTempPlans] = useState(draft?.tempPlans ?? [...plans]);

  const saveDraft = (currentStep = step, showToast = true) => {
    const draftData = {
      step: currentStep, tempLibraryName, tempBranches, tempSections, tempSeatTypes, tempSeats, tempShifts, tempPlans
    };
    localStorage.setItem('wizardDraft', JSON.stringify(draftData));
    setDraft(draftData);
    if (showToast) toast.success('Progress saved successfully.');
  };

  const resetStep = () => {
    if (window.confirm('Are you sure you want to discard unsaved changes for this step?')) {
      if (step === 1) {
        setTempLibraryName(settings.name || '');
        setTempBranches([...branches]);
      } else if (step === 2) {
        setTempSections([...sections]);
      } else if (step === 3) {
        setTempSeatTypes([...seatTypes]);
      } else if (step === 4) {
        setTempShifts([...shifts]);
      } else if (step === 5) {
        setTempSeats([...seats]);
      } else if (step === 6) {
        setTempPlans([...plans]);
      }
      toast.success('Step reset to original configuration.');
    }
  };

  // Helper to sync branch code
  const updateBranchName = (bId, newName) => {
    setTempBranches(tempBranches.map(b => b.id === bId ? { ...b, name: newName, code: newName.substring(0, 3).toUpperCase() } : b));
  };

  const handleNext = () => {
    if (step === 1 && !tempLibraryName.trim()) return toast.error("Library Name is required.");
    if (step === 1 && tempBranches.some(b => !b.name.trim())) return toast.error("All branches must have a name.");
    
    if (step === 6 && tempPlans.length === 0) return toast.error('You must create at least one fee plan to continue.');
    
    if (step < totalSteps) {
      saveDraft(step + 1, false);
      setStep(step + 1);
    }
    else {
      handleComplete();
    }
  };

  const handleComplete = () => {
    // 1. Assign libId to everything if missing
    const libId = settings.libraryId || \`lib-\${Date.now()}\`;
    
    setSettings({ ...settings, name: tempLibraryName, isSetupComplete: true, libraryId: libId });
    setBranches(tempBranches.map(b => ({ ...b, libraryId: libId })));
    setSections(tempSections.map(s => ({ ...s, libraryId: libId })));
    setSeatTypes(tempSeatTypes.map(st => ({ ...st, libraryId: libId })));
    setSeats(tempSeats.map(s => ({ ...s, libraryId: libId })));
    setShifts(tempShifts.map(sh => ({ ...sh, libraryId: libId })));
    setPlans(tempPlans.map(p => ({ ...p, libraryId: libId })));
    
    localStorage.removeItem('wizardDraft');
    toast.success("Library configuration completed and saved safely!");
    // Force a small delay to ensure states flush
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  };

  // Renders
  const renderStep1 = () => (
    <div>
      <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>Step 1: Library & Branches</h3>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>Enter your Library's name. Branch is optional. If you have only one location, you do not need to add a Branch.</p>
      
      <div className="form-group">
        <label className="form-label">Library Name *</label>
        <input className="form-input" value={tempLibraryName} onChange={e => {
            setTempLibraryName(e.target.value);
            // If there's only one branch and it's practically empty, sync it for convenience
            if (tempBranches.length === 1 && tempBranches[0].name === '') {
              updateBranchName(tempBranches[0].id, e.target.value);
            }
        }} placeholder="e.g. Accomplish Reading Zone" />
      </div>
      
      {tempBranches.length > 0 && (
        <h4 style={{ fontSize: '14px', fontWeight: 600, marginTop: '24px', marginBottom: '12px' }}>Branches (Optional)</h4>
      )}
      
      {tempBranches.map((b) => (
        <div key={b.id} style={{ display: 'flex', gap: '12px', marginBottom: '12px', alignItems: 'flex-start', background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              <input className="form-input" value={b.name} onChange={e => updateBranchName(b.id, e.target.value)} placeholder="Branch Name (e.g. Shalin Galleria)" style={{ flex: 1 }} />
              <input className="form-input" value={b.code} disabled placeholder="Code" style={{ width: '80px', background: '#e2e8f0' }} title="Auto-generated Branch Code" />
            </div>
            <input className="form-input" value={b.address} onChange={e => {
              setTempBranches(tempBranches.map(tb => tb.id === b.id ? { ...tb, address: e.target.value } : tb));
            }} placeholder="Branch Address (Optional)" />
          </div>
          <button className="btn btn-ghost" style={{ color: 'var(--danger-color)', padding: '8px' }} onClick={() => {
            if (students.some(s => s.branchId === b.id)) return toast.error('Cannot delete branch with enrolled students.');
            setTempBranches(tempBranches.filter(tb => tb.id !== b.id));
            setTempSections(tempSections.filter(ts => ts.branchId !== b.id));
            setTempSeatTypes(tempSeatTypes.filter(st => st.branchId !== b.id));
            setTempShifts(tempShifts.filter(sh => sh.branchId !== b.id));
            setTempPlans(tempPlans.filter(p => p.branchId !== b.id));
          }}><Trash2 size={16} /></button>
        </div>
      ))}
      <button className="btn btn-secondary" style={{ marginTop: tempBranches.length === 0 ? '16px' : '0' }} onClick={() => {
        setTempBranches([...tempBranches, { id: \`b-\${Date.now()}\`, code: "", name: "", address: "", active: true }]);
      }}><Plus size={14} /> Add Branch</button>
      
      {tempBranches.length === 1 && (
        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
           <ShieldAlert size={14} /> If you only have one location, you can delete this branch and keep it simple.
        </div>
      )}
    </div>
  );

  const renderStep2 = () => {
    // Determine context. Either we add sections directly to Library, or we add to specific branches.
    const contexts = tempBranches.length > 0 ? tempBranches : [{ id: null, name: 'Library Level (No Branches)' }];
    
    return (
      <div>
        <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>Step 2: Sections / Rooms (Optional)</h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>Add sections (e.g., AC Room, Non-AC Room) if you need them. You can skip this step to keep it simple.</p>
        
        {contexts.map((ctx) => {
          const branchSections = tempSections.filter(sec => sec.branchId === ctx.id);
          const isSimplified = contexts.length === 1 && branchSections.length === 0;
          
          return (
            <div key={ctx.id || 'lib'} style={{ border: isSimplified ? 'none' : '1px solid var(--border-light)', padding: isSimplified ? '0' : '16px', borderRadius: '8px', marginBottom: '16px', background: isSimplified ? 'transparent' : 'var(--bg-surface)' }}>
              {!isSimplified && ctx.id && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h4 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--brand-primary)' }}>{ctx.name}</h4>
                </div>
              )}
              
              {branchSections.map((sec) => (
                <div key={sec.id} style={{ display: 'flex', gap: '12px', marginBottom: '8px', alignItems: 'center' }}>
                  <input className="form-input" value={sec.name} onChange={e => {
                    setTempSections(tempSections.map(s => s.id === sec.id ? { ...s, name: e.target.value } : s));
                  }} placeholder="e.g. Premium Room" style={{ flex: 1 }} />
                  <button className="btn btn-ghost" style={{ color: 'var(--danger-color)' }} onClick={() => {
                    if (students.some(s => s.sectionId === sec.id)) return toast.error('Cannot delete section with enrolled students.');
                    setTempSections(tempSections.filter(s => s.id !== sec.id));
                  }}><Trash2 size={16} /></button>
                </div>
              ))}
              <button className="btn btn-secondary" onClick={() => {
                setTempSections([...tempSections, { id: \`sec-\${Date.now()}\`, branchId: ctx.id, name: "", active: true }]);
              }}><Plus size={14} /> Add Section</button>
            </div>
          );
        })}
      </div>
    );
  };

  const renderStep3 = () => {
    // Seat Types are the definitive configuration layer.
    // They can belong to a section, a branch, or just the library directly.
    return (
      <div>
        <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>Step 3: Seat Types (Required)</h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>Define seat types (e.g. Fixed, Non-Fixed). You must have at least one Seat Type.</p>
        
        {tempSeatTypes.map(st => (
          <div key={st.id} style={{ border: '1px solid var(--border-light)', padding: '16px', borderRadius: '8px', marginBottom: '16px', background: 'var(--bg-surface)' }}>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', alignItems: 'flex-start' }}>
               <div style={{ flex: 1 }}>
                  <label className="form-label" style={{ fontSize: '12px' }}>Seat Type Name</label>
                  <input className="form-input" value={st.name} onChange={e => {
                    setTempSeatTypes(tempSeatTypes.map(item => item.id === st.id ? { ...item, name: e.target.value } : item));
                  }} placeholder="e.g. Standard Fixed" />
               </div>
               
               {/* Context Selectors - progressive hiding */}
               {tempBranches.length > 0 && (
                  <div style={{ width: '150px' }}>
                    <label className="form-label" style={{ fontSize: '12px' }}>Branch (Optional)</label>
                    <select className="form-select" value={st.branchId || 'all'} onChange={e => {
                      const bId = e.target.value === 'all' ? undefined : e.target.value;
                      setTempSeatTypes(tempSeatTypes.map(item => item.id === st.id ? { ...item, branchId: bId, sectionId: undefined } : item));
                    }}>
                      <option value="all">All Branches</option>
                      {tempBranches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
               )}
               
               {tempSections.length > 0 && st.branchId && st.branchId !== 'all' && (
                  <div style={{ width: '150px' }}>
                    <label className="form-label" style={{ fontSize: '12px' }}>Section (Optional)</label>
                    <select className="form-select" value={st.sectionId || 'all'} onChange={e => {
                      const sId = e.target.value === 'all' ? undefined : e.target.value;
                      setTempSeatTypes(tempSeatTypes.map(item => item.id === st.id ? { ...item, sectionId: sId } : item));
                    }}>
                      <option value="all">All Sections</option>
                      {tempSections.filter(sec => sec.branchId === st.branchId).map(sec => <option key={sec.id} value={sec.id}>{sec.name}</option>)}
                    </select>
                  </div>
               )}

               <button className="btn btn-ghost" style={{ color: 'var(--danger-color)', marginTop: '22px' }} onClick={() => {
                 setTempSeatTypes(tempSeatTypes.filter(item => item.id !== st.id));
               }}><Trash2 size={16} /></button>
            </div>
            
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', background: '#f8fafc', padding: '12px', borderRadius: '4px' }}>
               <div style={{ width: '150px' }}>
                  <label className="form-label" style={{ fontSize: '12px' }}>Allocation Mode</label>
                  <select className="form-select" value={st.allocationMode || 'Fixed'} onChange={e => {
                    const mode = e.target.value;
                    setTempSeatTypes(tempSeatTypes.map(item => item.id === st.id ? { 
                      ...item, 
                      allocationMode: mode, 
                      capacityMode: mode === 'Non-Fixed' ? 'Unlimited' : null,
                      maximumStudentsAllowed: null
                    } : item));
                  }}>
                    <option value="Fixed">Fixed Seat</option>
                    <option value="Non-Fixed">Non-Fixed (Capacity)</option>
                  </select>
               </div>
               
               {st.allocationMode === 'Non-Fixed' && (
                  <>
                     <div style={{ width: '150px' }}>
                        <label className="form-label" style={{ fontSize: '12px' }}>Capacity Mode</label>
                        <select className="form-select" value={st.capacityMode || 'Unlimited'} onChange={e => {
                          setTempSeatTypes(tempSeatTypes.map(item => item.id === st.id ? { ...item, capacityMode: e.target.value } : item));
                        }}>
                          <option value="Unlimited">Unlimited</option>
                          <option value="Limited">Limited Capacity</option>
                        </select>
                     </div>
                     
                     {st.capacityMode === 'Limited' && (
                        <div style={{ width: '150px' }}>
                           <label className="form-label" style={{ fontSize: '12px' }}>Max Students</label>
                           <NumericInput className="form-input" value={st.maximumStudentsAllowed || 0} onChange={e => {
                             setTempSeatTypes(tempSeatTypes.map(item => item.id === st.id ? { ...item, maximumStudentsAllowed: Number(e.target.value) } : item));
                           }} />
                        </div>
                     )}
                  </>
               )}
            </div>
          </div>
        ))}
        
        <button className="btn btn-secondary" onClick={() => {
          setTempSeatTypes([...tempSeatTypes, { 
            id: \`st-\${Date.now()}\`, 
            name: "", 
            branchId: tempBranches.length === 1 ? tempBranches[0].id : undefined,
            sectionId: undefined,
            allocationMode: 'Fixed'
          }]);
        }}><Plus size={14} /> Add Seat Type</button>
      </div>
    );
  };

  const renderStep4 = () => (
    <div>
      <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>Step 4: Shifts</h3>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>Define operating shifts (optional per branch).</p>
      
      {tempShifts.map(sh => (
        <div key={sh.id} style={{ display: 'flex', gap: '12px', marginBottom: '8px', alignItems: 'center' }}>
          <input className="form-input" value={sh.name} onChange={e => {
            setTempShifts(tempShifts.map(item => item.id === sh.id ? { ...item, name: e.target.value } : item));
          }} placeholder="e.g. Morning Shift" style={{ flex: 1 }} />
          
          <select className="form-select" value={sh.durationType || 'Half Day'} onChange={e => {
            setTempShifts(tempShifts.map(item => item.id === sh.id ? { ...item, durationType: e.target.value } : item));
          }} style={{ width: '160px' }}>
            <option value="Half Day">Half Day</option>
            <option value="Full Day">Full Day</option>
            <option value="Custom Duration">Custom Duration</option>
          </select>
          
          {tempBranches.length > 0 && (
            <select className="form-select" value={sh.branchId || 'all'} onChange={e => {
              const bId = e.target.value === 'all' ? undefined : e.target.value;
              setTempShifts(tempShifts.map(item => item.id === sh.id ? { ...item, branchId: bId } : item));
            }} style={{ width: '150px' }}>
              <option value="all">All Branches</option>
              {tempBranches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}

          <button className="btn btn-ghost" style={{ color: 'var(--danger-color)' }} onClick={() => {
            setTempShifts(tempShifts.filter(item => item.id !== sh.id));
          }}><Trash2 size={16} /></button>
        </div>
      ))}
      <button className="btn btn-secondary" style={{ marginTop: '12px' }} onClick={() => {
        setTempShifts([...tempShifts, { 
          id: \`sh-\${Date.now()}\`, 
          name: "", 
          durationType: 'Half Day',
          branchId: tempBranches.length === 1 ? tempBranches[0].id : undefined
        }]);
      }}><Plus size={14} /> Add Shift</button>
    </div>
  );

  const renderStep5 = () => {
    // Only Fixed seat types get physical seats generated.
    // Determine rendering contexts based on where Fixed Seat Types live.
    const fixedTypes = tempSeatTypes.filter(st => st.allocationMode === 'Fixed');
    if (fixedTypes.length === 0) {
      return (
        <div>
          <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>Step 5: Seat Map</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>No Fixed seat types configured. Physical seat generation is not required for Non-Fixed capacity.</p>
        </div>
      );
    }
    
    // Group by section, branch, or library
    const renderContexts = [];
    
    fixedTypes.forEach(st => {
      let ctx = renderContexts.find(c => c.sectionId === st.sectionId && c.branchId === st.branchId);
      if (!ctx) {
         renderContexts.push({ branchId: st.branchId, sectionId: st.sectionId });
      }
    });

    return (
      <div>
        <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>Step 5: Seat Map (Fixed Seats Only)</h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>Generate physical seats for your Fixed Seat Types.</p>
        
        {renderContexts.map((ctx, idx) => {
          const branch = tempBranches.find(b => b.id === ctx.branchId);
          const section = tempSections.find(s => s.id === ctx.sectionId);
          
          let name = "Library Level Seats";
          if (branch && section) name = \`\${branch.name} - \${section.name}\`;
          else if (branch) name = \`\${branch.name} Level Seats\`;
          else if (section) name = \`Section \${section.name}\`; // rare
          
          return (
            <BlockSeatGenerator 
              key={idx}
              sectionId={ctx.sectionId}
              sectionName={name}
              tempSeats={tempSeats}
              setTempSeats={setTempSeats}
              tempSeatTypes={tempSeatTypes}
            />
          );
        })}
      </div>
    );
  };

  const renderStep6 = () => {
    return (
      <div>
        <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>Step 6: Fee Plans</h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>Create pricing plans.</p>
        
        {tempPlans.map(p => (
            <div key={p.id} style={{ padding: '12px', border: '1px dashed var(--border-light)', borderRadius: '8px', marginBottom: '12px', background: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <input className="form-input" style={{ flex: 1, marginRight: '12px', fontWeight: 600 }} value={p.name} onChange={e => {
                  setTempPlans(tempPlans.map(item => item.id === p.id ? { ...item, name: e.target.value } : item));
                }} placeholder="e.g. Monthly Standard Plan" />
                <button className="btn btn-ghost" style={{ color: 'var(--danger-color)' }} onClick={() => {
                  setTempPlans(tempPlans.filter(item => item.id !== p.id));
                }}><Trash2 size={16} /></button>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
                
                {tempBranches.length > 0 && (
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '11px' }}>Branch</label>
                    <select className="form-select" style={{ fontSize: '12px', padding: '6px' }} value={p.branchId || 'all'} onChange={e => {
                      const bId = e.target.value === 'all' ? undefined : e.target.value;
                      setTempPlans(tempPlans.map(item => item.id === p.id ? { ...item, branchId: bId, blockIds: [] } : item));
                    }}>
                      <option value="all">All Branches</option>
                      {tempBranches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                )}
                
                {tempSections.length > 0 && p.branchId && p.branchId !== 'all' && (
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '11px' }}>Section</label>
                    <select className="form-select" style={{ fontSize: '12px', padding: '6px' }} value={p.blockIds?.[0] || 'all'} onChange={e => {
                      const sId = e.target.value === 'all' ? [] : [e.target.value];
                      setTempPlans(tempPlans.map(item => item.id === p.id ? { ...item, blockIds: sId, seatTypeId: '' } : item));
                    }}>
                      <option value="all">All Sections</option>
                      {tempSections.filter(sec => sec.branchId === p.branchId).map(sec => <option key={sec.id} value={sec.id}>{sec.name}</option>)}
                    </select>
                  </div>
                )}

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '11px' }}>Seat Type</label>
                  <select className="form-select" style={{ fontSize: '12px', padding: '6px' }} value={p.seatTypeId || ''} onChange={e => {
                    setTempPlans(tempPlans.map(item => item.id === p.id ? { ...item, seatTypeId: e.target.value } : item));
                  }}>
                    <option value="">Select Seat Type</option>
                    {tempSeatTypes
                      .filter(st => (!p.branchId || st.branchId === p.branchId || !st.branchId) && (!p.blockIds?.[0] || st.sectionId === p.blockIds[0] || !st.sectionId))
                      .map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
                  </select>
                </div>
                
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '11px' }}>Shifts</label>
                  <select multiple className="form-select" style={{ fontSize: '12px', padding: '6px', minHeight: '60px' }} value={p.shiftIds || (p.shiftId ? [p.shiftId] : [])} onChange={e => {
                    const selected = Array.from(e.target.selectedOptions, option => option.value);
                    setTempPlans(tempPlans.map(item => item.id === p.id ? { ...item, shiftIds: selected, shiftId: undefined } : item));
                  }}>
                    {tempShifts
                      .filter(sh => !p.branchId || sh.branchId === p.branchId || !sh.branchId)
                      .map(sh => <option key={sh.id} value={sh.id}>{sh.name}</option>)}
                  </select>
                  <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '4px' }}>Hold Cmd/Ctrl to multi-select</div>
                </div>
                
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '12px' }}>Price (₹)</label>
                  <NumericInput className="form-input" style={{ fontSize: '12px', padding: '6px' }} value={p.price} onChange={e => {
                    setTempPlans(tempPlans.map(item => item.id === p.id ? { ...item, price: e.target.value } : item));
                  }} />
                </div>
                
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '12px' }}>Duration (Months)</label>
                  <NumericInput className="form-input" style={{ fontSize: '12px', padding: '6px' }} value={p.durationMonths} onChange={e => {
                    setTempPlans(tempPlans.map(item => item.id === p.id ? { ...item, durationMonths: Number(e.target.value) } : item));
                  }} min={1} />
                </div>
              </div>
            </div>
        ))}
        
        <button className="btn btn-secondary" onClick={() => {
          setTempPlans([...tempPlans, {
            id: \`pl-\${Date.now()}\`, name: "", price: 1000, durationMonths: 1,
            blockIds: [], seatTypeId: '', shiftIds: [], active: true,
            branchId: tempBranches.length === 1 ? tempBranches[0].id : undefined
          }]);
        }}><Plus size={14} /> Add Plan</button>
      </div>
    );
  };

  const renderStep7 = () => {
    const totalSeats = tempSeats.length;
    const hasPlans = tempPlans.length > 0;
    
    return (
      <div style={{ padding: '20px' }}>
        <CheckCircle size={48} color="#10b981" style={{ margin: '0 0 20px' }} />
        <h3 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '24px' }}>Review & Finish</h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '32px', maxWidth: '600px' }}>
          Please review your configuration. You can always edit these settings later in the Library Settings menu.
          Data is explicitly scoped according to your selections.
        </p>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
          <div className="premium-card" style={{ padding: '16px' }}>
            <h4 style={{ color: 'var(--text-secondary)' }}>Library Hierarchy</h4>
            <div style={{ fontSize: '20px', fontWeight: 600 }}>{tempLibraryName || 'Unnamed'}</div>
            <div style={{ fontSize: '14px', color: 'var(--text-tertiary)' }}>{tempBranches.length} Branches, {tempSections.length} Sections</div>
          </div>
          <div className="premium-card" style={{ padding: '16px' }}>
            <h4 style={{ color: 'var(--text-secondary)' }}>Configured Physical Seats</h4>
            <div style={{ fontSize: '24px', fontWeight: 600 }}>{totalSeats}</div>
          </div>
          <div className="premium-card" style={{ padding: '16px' }}>
            <h4 style={{ color: 'var(--text-secondary)' }}>Seat Types & Shifts</h4>
            <div style={{ fontSize: '24px', fontWeight: 600 }}>{tempSeatTypes.length} / {tempShifts.length}</div>
          </div>
          <div className="premium-card" style={{ padding: '16px' }}>
            <h4 style={{ color: 'var(--text-secondary)' }}>Fee Plans</h4>
            <div style={{ fontSize: '24px', fontWeight: 600, color: hasPlans ? 'inherit' : '#ef4444' }}>{tempPlans.length}</div>
          </div>
        </div>
        
        {!hasPlans && (
          <div style={{ background: '#fef2f2', padding: '12px', borderRadius: '8px', color: '#dc2626', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <ShieldAlert size={20} />
            <span>You need at least one Fee Plan to enroll students. Go back to Step 6.</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      <header style={{ padding: '20px 40px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <Building2 size={24} color="var(--brand-primary)" />
        <h1 style={{ fontSize: '20px', fontWeight: 700 }}>Library Setup Wizard</h1>
      </header>

      <main style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px' }}>
        <motion.div 
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          style={{ background: 'var(--bg-surface)', width: '100%', maxWidth: '800px', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', overflow: 'hidden' }}
        >
          <div style={{ display: 'flex', background: '#f8fafc', padding: '20px 40px', borderBottom: '1px solid var(--border-light)' }}>
            {[1, 2, 3, 4, 5, 6, 7].map(s => (
              <div key={s} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                <div style={{ 
                  width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: step >= s ? 'var(--brand-primary)' : '#cbd5e1',
                  color: '#fff', fontWeight: 600, fontSize: '14px'
                }}>
                  {s}
                </div>
              </div>
            ))}
          </div>

          <div style={{ padding: '40px', minHeight: '400px' }}>
            {step === 1 && renderStep1()}
            {step === 2 && renderStep2()}
            {step === 3 && renderStep3()}
            {step === 4 && renderStep4()}
            {step === 5 && renderStep5()}
            {step === 6 && renderStep6()}
            {step === 7 && renderStep7()}
          </div>

          <div style={{ padding: '20px 40px', background: '#f8fafc', borderTop: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button className="btn btn-ghost" onClick={() => step > 1 && setStep(step - 1)} disabled={step === 1}>
                Back
              </button>
              <button className="btn btn-ghost" style={{ color: 'var(--danger-color)' }} onClick={resetStep}>
                Reset Step
              </button>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button className="btn btn-secondary" onClick={() => saveDraft(step)}>
                Save Progress
              </button>
              <button className="btn btn-primary" onClick={handleNext}>
                {step === totalSteps ? 'Finish Setup' : 'Save & Continue'}
              </button>
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  );
};
`;

fs.writeFileSync(path.join(__dirname, 'src/components/SetupWizard.jsx'), newSetupWizard, 'utf8');
console.log('SetupWizard rewritten successfully.');
