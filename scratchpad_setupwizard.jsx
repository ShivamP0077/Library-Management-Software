import React, { useState, useEffect } from 'react';
import { useLibrary } from '../context/LibraryContext';
import { motion, AnimatePresence } from 'framer-motion';
import { Building2, Grid, Clock, CheckCircle, Plus, Trash2, ShieldAlert, Copy, ChevronRight, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { NumericInput } from './NumericInput';

const BlockSeatGenerator = ({ bIndex, blkIndex, blk, tempBranches, setTempBranches, tempSeatTypes }) => {
  const [prefix, setPrefix] = useState('S');
  const [startNum, setStartNum] = useState(1);
  const [endNum, setEndNum] = useState(20);
  
  const bSeatTypes = tempSeatTypes.filter(st => st.blockId === blk.id);
  const [selectedTypeId, setSelectedTypeId] = useState(bSeatTypes[0]?.id || '');

  useEffect(() => {
    if (!selectedTypeId && bSeatTypes.length > 0) {
      setSelectedTypeId(bSeatTypes[0].id);
    }
  }, [bSeatTypes, selectedTypeId]);

  const handleBulkAdd = () => {
    if (!selectedTypeId) return toast.error('Create a seat type first.');
    const newB = [...tempBranches];
    const currentSeats = newB[bIndex].blocks[blkIndex].seats || [];
    let addedCount = 0;
    for (let i = startNum; i <= endNum; i++) {
      const seatName = `${prefix}${i}`;
      if (!currentSeats.find(s => s.name === seatName)) {
        currentSeats.push({
          id: `seat-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          name: seatName, typeId: selectedTypeId, isMaintenance: false, isUnavailable: false
        });
        addedCount++;
      }
    }
    newB[bIndex].blocks[blkIndex].seats = currentSeats;
    setTempBranches(newB);
    toast.success(`Added ${addedCount} seats to ${blk.name}`);
  };

  return (
    <div style={{ border: '1px solid var(--border-light)', padding: '16px', borderRadius: '8px', marginBottom: '12px', background: 'var(--bg-surface)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h5 style={{ fontWeight: 600 }}>{blk.name}</h5>
        <span style={{ fontSize: '12px', background: '#e0f2fe', color: '#0284c7', padding: '4px 8px', borderRadius: '4px' }}>
          Total Seats: {blk.seats?.length || 0}
        </span>
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label" style={{ fontSize: '12px' }}>Prefix</label><input className="form-input" style={{ width: '80px' }} value={prefix} onChange={e => setPrefix(e.target.value)} /></div>
        <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label" style={{ fontSize: '12px' }}>Start</label><NumericInput className="form-input" style={{ width: '80px' }} value={startNum} onChange={e => setStartNum(Number(e.target.value))} /></div>
        <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label" style={{ fontSize: '12px' }}>End</label><NumericInput className="form-input" style={{ width: '80px' }} value={endNum} onChange={e => setEndNum(Number(e.target.value))} /></div>
        <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
          <label className="form-label" style={{ fontSize: '12px' }}>Seat Type</label>
          <select className="form-select" value={selectedTypeId} onChange={e => setSelectedTypeId(e.target.value)}>
            {bSeatTypes.map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
          </select>
        </div>
        <button className="btn btn-secondary" onClick={handleBulkAdd}><Plus size={14} /> Bulk Add</button>
      </div>
    </div>
  );
};

export const SetupWizard = () => {
  const { 
    settings, setSettings,
    branches, setBranches,
    seatTypes, setSeatTypes,
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

  // Global Config
  const [tempLibraryName, setTempLibraryName] = useState(draft?.tempLibraryName ?? (settings.name || ''));

  // Dynamic Config State
  const [tempBranches, setTempBranches] = useState(draft?.tempBranches ?? (branches.length > 0 ? branches : [
    { id: `b-${Date.now()}`, code: "", name: "", address: "", active: true, blocks: [] }
  ]));
  const [tempSeatTypes, setTempSeatTypes] = useState(draft?.tempSeatTypes ?? (seatTypes?.length > 0 ? seatTypes : []));
  const [tempShifts, setTempShifts] = useState(draft?.tempShifts ?? (shifts?.length > 0 ? shifts : []));
  const [tempPlans, setTempPlans] = useState(draft?.tempPlans ?? (plans?.length > 0 ? plans : []));

  const saveDraft = (currentStep = step, showToast = true) => {
    const draftData = {
      step: currentStep, tempLibraryName, tempBranches, tempSeatTypes, tempShifts, tempPlans
    };
    localStorage.setItem('wizardDraft', JSON.stringify(draftData));
    setDraft(draftData);
    if (showToast) toast.success('Progress saved successfully.');
  };

  const resetStep = () => {
    if (window.confirm('Are you sure you want to discard unsaved changes for this step?')) {
      if (step === 1 || step === 2) {
        setTempLibraryName(settings.name || '');
        setTempBranches(branches.length > 0 ? branches : [{ id: `b-${Date.now()}`, code: "", name: "", address: "", active: true, blocks: [] }]);
      } else if (step === 3) {
        setTempSeatTypes(seatTypes?.length > 0 ? seatTypes : []);
      } else if (step === 4) {
        setTempShifts(shifts?.length > 0 ? shifts : []);
      } else if (step === 5) {
        setTempPlans(plans?.length > 0 ? plans : []);
      }
      toast.success('Step reset to original configuration.');
    }
  };

  // UI State
  const [activeBranchId, setActiveBranchId] = useState(tempBranches[0]?.id);

  // Helper to sync branch code
  const updateBranchName = (bIndex, newName) => {
    const newB = [...tempBranches];
    newB[bIndex].name = newName;
    newB[bIndex].code = newName.substring(0, 3).toUpperCase();
    setTempBranches(newB);
  };

  const handleCopyFromBranch = (targetBranchId, sourceBranchId, type) => {
    if (!sourceBranchId || !targetBranchId || sourceBranchId === targetBranchId) return;

    if (type === 'sections') {
      const sourceBranch = tempBranches.find(b => b.id === sourceBranchId);
      const targetBranchIndex = tempBranches.findIndex(b => b.id === targetBranchId);
      if (sourceBranch && targetBranchIndex !== -1) {
        const copiedBlocks = sourceBranch.blocks.map(blk => ({
          ...blk,
          id: `blk-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          seats: [] // Copying sections shouldn't copy seats natively unless explicitly asked
        }));
        const newB = [...tempBranches];
        newB[targetBranchIndex].blocks = [...newB[targetBranchIndex].blocks, ...copiedBlocks];
        setTempBranches(newB);
        toast.success(`Copied ${copiedBlocks.length} sections from ${sourceBranch.name}`);
      }
    } else if (type === 'seatTypes') {
      const sourceBranch = tempBranches.find(b => b.id === sourceBranchId);
      const targetBranch = tempBranches.find(b => b.id === targetBranchId);
      const sourceTypes = tempSeatTypes.filter(st => st.branchId === sourceBranchId);
      
      const copiedTypes = [];
      let skippedCount = 0;
      
      sourceTypes.forEach(st => {
        const sourceBlock = sourceBranch.blocks.find(blk => blk.id === st.blockId);
        const targetBlock = targetBranch.blocks.find(blk => blk.name === sourceBlock?.name);
        
        if (targetBlock) {
          copiedTypes.push({
            ...st,
            id: `st-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            branchId: targetBranchId,
            blockId: targetBlock.id
          });
        } else {
          skippedCount++;
        }
      });
      
      setTempSeatTypes([...tempSeatTypes, ...copiedTypes]);
      if (skippedCount > 0) {
        toast.error(`Skipped ${skippedCount} seat types due to missing sections.`);
      } else {
        toast.success(`Copied ${copiedTypes.length} seat types.`);
      }
    } else if (type === 'shifts') {
      const sourceShifts = tempShifts.filter(sh => sh.branchId === sourceBranchId);
      const copiedShifts = sourceShifts.map(sh => ({
        ...sh,
        id: `sh-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        branchId: targetBranchId
      }));
      setTempShifts([...tempShifts, ...copiedShifts]);
      toast.success(`Copied ${copiedShifts.length} shifts.`);
    } else if (type === 'plans') {
      // Copying plans is tricky. We need to map the source plan's shift/seatType to the target's newly copied ones (by name).
      const sourcePlans = tempPlans.filter(p => p.branchId === sourceBranchId);
      const targetShifts = tempShifts.filter(sh => sh.branchId === targetBranchId);
      const targetSeatTypes = tempSeatTypes.filter(st => st.branchId === targetBranchId);
      const sourceBranch = tempBranches.find(b => b.id === sourceBranchId);
      const targetBranch = tempBranches.find(b => b.id === targetBranchId);

      const copiedPlans = [];
      let skippedCount = 0;

      sourcePlans.forEach(p => {
        // Find matching source shifts
        const sourceShifts = p.shiftIds ? p.shiftIds.map(id => tempShifts.find(sh => sh.id === id)).filter(Boolean) : 
                           (p.shiftId ? [tempShifts.find(sh => sh.id === p.shiftId)].filter(Boolean) : []);
        
        const sourceSeatType = tempSeatTypes.find(st => st.id === p.seatTypeId);
        const sourceBlock = sourceBranch.blocks.find(blk => p.blockIds?.includes(blk.id));

        // Find corresponding target shifts
        const targetMatchedShifts = sourceShifts.map(sSh => targetShifts.find(tSh => tSh.name === sSh.name)).filter(Boolean);
        const targetSeatType = targetSeatTypes.find(st => st.name === sourceSeatType?.name);
        const targetBlock = targetBranch.blocks.find(blk => blk.name === sourceBlock?.name);

        if (targetMatchedShifts.length > 0 && targetSeatType && targetBlock) {
          copiedPlans.push({
            ...p,
            id: `pl-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            branchId: targetBranchId,
            shiftIds: targetMatchedShifts.map(sh => sh.id),
            shiftId: undefined, // ensure legacy is removed
            seatTypeId: targetSeatType.id,
            blockIds: [targetBlock.id]
          });
        } else {
          skippedCount++;
        }
      });
      setTempPlans([...tempPlans, ...copiedPlans]);
      if (skippedCount > 0) {
        toast.error(`Skipped ${skippedCount} plans because matching sections/shifts/seat types weren't found in this branch.`);
      } else {
        toast.success(`Copied ${copiedPlans.length} fee plans.`);
      }
    }
  };

  const handleNext = () => {
    if (step === 1 && !tempLibraryName.trim()) return toast.error("Library Name is required.");
    if (step === 1 && tempBranches.some(b => !b.name.trim())) return toast.error("All branches must have a name.");
    
    if (step === 5) {
      // Validation: Ensure every configured section has at least one seat
      for (const branch of tempBranches) {
        for (const block of branch.blocks) {
          if (!block.seats || block.seats.length === 0) {
            return toast.error(`Section "${block.name}" in branch "${branch.name}" needs at least one seat before continuing.`);
          }
        }
      }
    }
    
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
    setSettings({ ...settings, name: tempLibraryName, isSetupComplete: true });
    setBranches(tempBranches);
    setSeatTypes(tempSeatTypes);
    setShifts(tempShifts);
    setPlans(tempPlans);
    localStorage.removeItem('wizardDraft');
    toast.success("Library configuration completed and saved safely!");
  };

  // Renders
  const renderStep1 = () => (
    <div>
      <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>Step 1: Library & Branches</h3>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>Enter your Library's name. Add branches if you have multiple locations.</p>
      
      <div className="form-group">
        <label className="form-label">Library Name *</label>
        <input className="form-input" value={tempLibraryName} onChange={e => {
            setTempLibraryName(e.target.value);
            if (tempBranches.length === 1) {
              updateBranchName(0, e.target.value);
            }
        }} placeholder="e.g. Accomplish Reading Zone" />
      </div>

      {tempBranches.length > 1 && (
        <h4 style={{ fontSize: '14px', fontWeight: 600, marginTop: '24px', marginBottom: '12px' }}>Branches</h4>
      )}
      
      {tempBranches.length > 1 && tempBranches.map((b, bIndex) => (
        <div key={b.id} style={{ display: 'flex', gap: '12px', marginBottom: '12px', alignItems: 'flex-start', background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              <input className="form-input" value={b.name} onChange={e => updateBranchName(bIndex, e.target.value)} placeholder="Branch Name (e.g. Shalin Galleria)" style={{ flex: 1 }} />
              <input className="form-input" value={b.code} disabled placeholder="Code" style={{ width: '80px', background: '#e2e8f0' }} title="Auto-generated Branch Code" />
            </div>
            <input className="form-input" value={b.address} onChange={e => {
              const newB = [...tempBranches];
              newB[bIndex].address = e.target.value;
              setTempBranches(newB);
            }} placeholder="Branch Address (Optional)" />
          </div>
          <button className="btn btn-ghost" style={{ color: 'var(--danger-color)', padding: '8px' }} onClick={() => {
            if (tempBranches.length === 1) return toast.error("You must have at least one branch.");
            if (students.some(s => s.branchId === b.id)) return toast.error('Cannot delete branch with enrolled students.');
            setTempBranches(tempBranches.filter((_, i) => i !== bIndex));
          }}><Trash2 size={16} /></button>
        </div>
      ))}
      <button className="btn btn-secondary" style={{ marginTop: tempBranches.length === 1 ? '16px' : '0' }} onClick={() => {
        setTempBranches([...tempBranches, { id: `b-${Date.now()}`, code: "", name: "", address: "", active: true, blocks: [] }]);
      }}><Plus size={14} /> Add Branch</button>
    </div>
  );

  const renderStep2 = () => (
    <div>
      <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>Step 2: Sections / Rooms</h3>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>Add sections (e.g., AC Room, Non-AC Room) for each branch.</p>
      
      {tempBranches.map((b, bIndex) => {
        const otherBranches = tempBranches.filter(ob => ob.id !== b.id);
        const isSimplified = tempBranches.length === 1;
        return (
          <div key={b.id} style={{ border: isSimplified ? 'none' : '1px solid var(--border-light)', padding: isSimplified ? '0' : '16px', borderRadius: '8px', marginBottom: '16px', background: isSimplified ? 'transparent' : 'var(--bg-surface)' }}>
            {!isSimplified && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h4 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--brand-primary)' }}>{b.name || 'Unnamed Branch'}</h4>
                {otherBranches.length > 0 && b.blocks.length === 0 && (
                  <select className="form-select" style={{ width: 'auto', padding: '4px 8px', fontSize: '12px' }} onChange={e => handleCopyFromBranch(b.id, e.target.value, 'sections')} defaultValue="">
                    <option value="" disabled>Copy from...</option>
                    {otherBranches.map(ob => <option key={ob.id} value={ob.id}>{ob.name}</option>)}
                  </select>
                )}
              </div>
            )}
            
            {b.blocks.map((blk, blkIndex) => (
              <div key={blk.id} style={{ display: 'flex', gap: '12px', marginBottom: '8px', alignItems: 'center' }}>
                <input className="form-input" value={blk.name} onChange={e => {
                  const newB = [...tempBranches];
                  newB[bIndex].blocks[blkIndex].name = e.target.value;
                  setTempBranches(newB);
                }} placeholder="e.g. Premium Room" style={{ flex: 1 }} />
                <button className="btn btn-ghost" style={{ color: 'var(--danger-color)' }} onClick={() => {
                  if (students.some(s => s.blockId === blk.id)) return toast.error('Cannot delete section with enrolled students.');
                  const newB = [...tempBranches];
                  newB[bIndex].blocks = newB[bIndex].blocks.filter((_, i) => i !== blkIndex);
                  setTempBranches(newB);
                }}><Trash2 size={16} /></button>
              </div>
            ))}
            <button className="btn btn-secondary" onClick={() => {
              const newB = [...tempBranches];
              newB[bIndex].blocks.push({ id: `blk-${Date.now()}`, name: "", seats: [], active: true });
              setTempBranches(newB);
            }}><Plus size={14} /> Add Section</button>
          </div>
        );
      })}
    </div>
  );

  const renderStep3 = () => (
    <div>
      <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>Step 3: Seat Types</h3>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>Define independent seat types (e.g. Fixed, Non-Fixed, VIP) per section.</p>
      
      {tempBranches.map(b => (
        <React.Fragment key={b.id}>
          {tempBranches.length > 1 && <h4 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--brand-primary)', marginBottom: '12px', marginTop: '16px' }}>{b.name || 'Unnamed Branch'}</h4>}
          {b.blocks.map(blk => {
            const blkSeatTypes = tempSeatTypes.filter(st => st.blockId === blk.id);
            const isSimplified = tempBranches.length === 1 && b.blocks.length === 1;
            
            return (
              <div key={blk.id} style={{ border: isSimplified ? 'none' : '1px solid var(--border-light)', padding: isSimplified ? '0' : '16px', borderRadius: '8px', marginBottom: '16px', background: isSimplified ? 'transparent' : 'var(--bg-surface)' }}>
                {!isSimplified && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h5 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>Section: {blk.name || 'Unnamed Section'}</h5>
                  </div>
                )}
                
                {blkSeatTypes.map(st => (
                  <div key={st.id} style={{ display: 'flex', gap: '12px', marginBottom: '8px', alignItems: 'center' }}>
                    <input className="form-input" value={st.name} onChange={e => {
                      setTempSeatTypes(tempSeatTypes.map(item => item.id === st.id ? { ...item, name: e.target.value } : item));
                    }} placeholder="e.g. Fixed, VIP" style={{ flex: 1 }} />
                    <button className="btn btn-ghost" style={{ color: 'var(--danger-color)' }} onClick={() => {
                      setTempSeatTypes(tempSeatTypes.filter(item => item.id !== st.id));
                    }}><Trash2 size={16} /></button>
                  </div>
                ))}
                <button className="btn btn-secondary" onClick={() => {
                  setTempSeatTypes([...tempSeatTypes, { id: `st-${Date.now()}`, name: "", branchId: b.id, blockId: blk.id }]);
                }}><Plus size={14} /> Add Seat Type</button>
              </div>
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );

  const renderStep4 = () => (
    <div>
      <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>Step 4: Shifts</h3>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>Define operating shifts independently per branch.</p>
      
      {tempBranches.map(b => {
        const bShifts = tempShifts.filter(sh => sh.branchId === b.id);
        const otherBranches = tempBranches.filter(ob => ob.id !== b.id);
        const isSimplified = tempBranches.length === 1;
        
        return (
          <div key={b.id} style={{ border: isSimplified ? 'none' : '1px solid var(--border-light)', padding: isSimplified ? '0' : '16px', borderRadius: '8px', marginBottom: '16px', background: isSimplified ? 'transparent' : 'var(--bg-surface)' }}>
            {!isSimplified && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h4 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--brand-primary)' }}>{b.name || 'Unnamed Branch'}</h4>
                {otherBranches.length > 0 && bShifts.length === 0 && (
                  <select className="form-select" style={{ width: 'auto', padding: '4px 8px', fontSize: '12px' }} onChange={e => handleCopyFromBranch(b.id, e.target.value, 'shifts')} defaultValue="">
                    <option value="" disabled>Copy from...</option>
                    {otherBranches.map(ob => <option key={ob.id} value={ob.id}>{ob.name}</option>)}
                  </select>
                )}
              </div>
            )}
            
            {bShifts.map(sh => (
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

                <button className="btn btn-ghost" style={{ color: 'var(--danger-color)' }} onClick={() => {
                  setTempShifts(tempShifts.filter(item => item.id !== sh.id));
                }}><Trash2 size={16} /></button>
              </div>
            ))}
            <button className="btn btn-secondary" onClick={() => {
              setTempShifts([...tempShifts, { id: `sh-${Date.now()}`, name: "", branchId: b.id, durationType: 'Half Day' }]);
            }}><Plus size={14} /> Add Shift</button>
          </div>
        );
      })}
    </div>
  );

  const renderStep5 = () => (
    <div>
      <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>Step 5: Seat Map</h3>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>Generate seats for your sections.</p>
      
      {tempBranches.map((b, bIndex) => (
        <div key={b.id} style={{ marginBottom: '24px' }}>
          <h4 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px', color: 'var(--brand-primary)' }}>{b.name}</h4>
           {b.blocks.map((blk, blkIndex) => (
            <BlockSeatGenerator 
              key={blk.id} 
              bIndex={bIndex} 
              blkIndex={blkIndex} 
              blk={blk} 
              tempBranches={tempBranches} 
              setTempBranches={setTempBranches} 
              tempSeatTypes={tempSeatTypes} 
            />
          ))}
        </div>
      ))}
    </div>
  );

  const renderStep6 = () => {
    return (
      <div>
        <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>Step 6: Fee Plans</h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>Create independent pricing plans per branch.</p>
        
        {tempBranches.map(b => {
          const bPlans = tempPlans.filter(p => p.branchId === b.id);
          const bShifts = tempShifts.filter(sh => sh.branchId === b.id);
          const otherBranches = tempBranches.filter(ob => ob.id !== b.id);
          const isSimplified = tempBranches.length === 1;

          return (
            <div key={b.id} style={{ border: isSimplified ? 'none' : '1px solid var(--border-light)', padding: isSimplified ? '0' : '16px', borderRadius: '8px', marginBottom: '24px', background: isSimplified ? 'transparent' : 'var(--bg-surface)' }}>
              {!isSimplified && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h4 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--brand-primary)' }}>{b.name || 'Unnamed Branch'}</h4>
                  {otherBranches.length > 0 && bPlans.length === 0 && (
                    <select className="form-select" style={{ width: 'auto', padding: '4px 8px', fontSize: '12px' }} onChange={e => handleCopyFromBranch(b.id, e.target.value, 'plans')} defaultValue="">
                      <option value="" disabled>Copy from...</option>
                      {otherBranches.map(ob => <option key={ob.id} value={ob.id}>{ob.name}</option>)}
                    </select>
                  )}
                </div>
              )}
              
              {bPlans.map(p => {
                const sectionSeatTypes = tempSeatTypes.filter(st => p.blockIds?.includes(st.blockId));
                
                return (
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
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontSize: '11px' }}>Section</label>
                        <select className="form-select" style={{ fontSize: '12px', padding: '6px' }} value={p.blockIds?.[0] || ''} onChange={e => {
                          setTempPlans(tempPlans.map(item => item.id === p.id ? { ...item, blockIds: [e.target.value], seatTypeId: '' } : item));
                        }}>
                          <option value="">Select Section</option>
                          {b.blocks.map(sec => <option key={sec.id} value={sec.id}>{sec.name}</option>)}
                        </select>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontSize: '11px' }}>Seat Type</label>
                        <select className="form-select" style={{ fontSize: '12px', padding: '6px' }} value={p.seatTypeId || ''} onChange={e => {
                          setTempPlans(tempPlans.map(item => item.id === p.id ? { ...item, seatTypeId: e.target.value } : item));
                        }}>
                          <option value="">Select Seat Type</option>
                          {sectionSeatTypes.map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
                        </select>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontSize: '11px' }}>Shifts</label>
                        <select multiple className="form-select" style={{ fontSize: '12px', padding: '6px', minHeight: '60px' }} value={p.shiftIds || (p.shiftId ? [p.shiftId] : [])} onChange={e => {
                          const selected = Array.from(e.target.selectedOptions, option => option.value);
                          setTempPlans(tempPlans.map(item => item.id === p.id ? { ...item, shiftIds: selected, shiftId: undefined } : item));
                        }}>
                          {bShifts.map(sh => <option key={sh.id} value={sh.id}>{sh.name}</option>)}
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
                        <label className="form-label" style={{ fontSize: '12px' }}>Subscription Duration (Months)</label>
                      <NumericInput className="form-input" style={{ fontSize: '12px', padding: '6px' }} value={p.durationMonths} onChange={e => {
                        setTempPlans(tempPlans.map(item => item.id === p.id ? { ...item, durationMonths: Number(e.target.value) } : item));
                      }} min={1} />
                    </div>
                    </div>
                  </div>
                );
              })}
              
              <button className="btn btn-secondary" onClick={() => {
                setTempPlans([...tempPlans, {
                  id: `pl-${Date.now()}`, name: "", branchId: b.id, price: 1000, durationMonths: 1,
                  blockIds: [b.blocks[0]?.id || ''], seatTypeId: tempSeatTypes.filter(st => st.blockId === b.blocks[0]?.id)[0]?.id || '', shiftIds: [bShifts[0]?.id].filter(Boolean), active: true
                }]);
              }}><Plus size={14} /> Add Plan</button>
            </div>
          );
        })}
      </div>
    );
  };

  const renderStep7 = () => {
    const totalSeats = tempBranches.reduce((acc, b) => acc + b.blocks.reduce((sAcc, blk) => sAcc + (blk.seats?.length || 0), 0), 0);
    const hasPlans = tempPlans.length > 0;
    
    return (
      <div style={{ padding: '20px' }}>
        <CheckCircle size={48} color="#10b981" style={{ margin: '0 0 20px' }} />
        <h3 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '24px' }}>Review & Finish</h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '32px', maxWidth: '600px' }}>
          Please review your configuration. You can always edit these settings later in the Library Settings menu.
          Data is strictly scoped per branch to ensure isolation.
        </p>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
          <div className="premium-card" style={{ padding: '16px' }}>
            <h4 style={{ color: 'var(--text-secondary)' }}>Library & Branches</h4>
            <div style={{ fontSize: '20px', fontWeight: 600 }}>{tempLibraryName || 'Unnamed'}</div>
            <div style={{ fontSize: '14px', color: 'var(--text-tertiary)' }}>{tempBranches.length} Branches, {tempBranches.reduce((a, b) => a + b.blocks.length, 0)} Sections</div>
          </div>
          <div className="premium-card" style={{ padding: '16px' }}>
            <h4 style={{ color: 'var(--text-secondary)' }}>Total Configured Seats</h4>
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
