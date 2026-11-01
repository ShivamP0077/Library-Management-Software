import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { useLibrary } from '../context/LibraryContext';
import { MoreVertical, Plus, Trash2, Settings, Ban, CheckCircle2, X, AlertCircle, Building2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { NumericInput } from './NumericInput';
import { resolveConfigurationScope, matchesScope } from '../utils/scopeResolver';
import { getCanonicalShifts, normalizeShiftName, resolveCanonicalShift, shiftsOverlap } from '../utils/shiftUtils';
import toast from 'react-hot-toast';

// Seat numbers must be compared exactly. Trimming protects against legacy
// whitespace while avoiding includes()/startsWith() partial matches (BUG-13).
const normalizeSeatKey = (value) => String(value ?? '').trim();
const isActiveStatus = (status) => status === 'Active' || status === 'Expiring Soon';
const getSeatKey = (seat) => normalizeSeatKey(seat?.name ?? seat?.seatNumber);
const isPhysicalSeatNo = (seatNo) => {
  const key = normalizeSeatKey(seatNo);
  return Boolean(key) && key !== 'Non-Fixed Seat' && key !== 'None';
};
const getStudentShift = (student, shifts) =>
  (shifts || []).find(sh => sh.id === student?.shiftId) || { id: student?.shiftId, name: student?.shift };

// Build a scope-accurate occupancy map for a section. Keys are exact seat
// numbers; values are the active/expiring students assigned to that seat.
// NOTE: Backend atomic seat assignment/unique constraints are follow-up work;
// this only fixes what the seat map displays.
const buildSeatOccupancy = (students, shifts, { libraryId, branchId, sectionId, shiftId }) => {
  const map = new Map();
  const requestedShift = shiftId ? ((shifts || []).find(sh => sh.id === shiftId) || { id: shiftId }) : null;

  (students || []).forEach(student => {
    if (!student || !isActiveStatus(student.status)) return;
    if (!isPhysicalSeatNo(student.seatNo)) return;
    if (libraryId && student.libraryId && student.libraryId !== libraryId) return;
    if (branchId && branchId !== 'all' && student.branchId && student.branchId !== 'all' && student.branchId !== branchId) return;
    if (sectionId && sectionId !== 'all' && student.sectionId && student.sectionId !== sectionId) return;

    if (requestedShift) {
      const studentShift = getStudentShift(student, shifts);
      if (!shiftsOverlap(studentShift, requestedShift)) return;
    }

    const key = normalizeSeatKey(student.seatNo);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(student);
  });

  return map;
};

// Duplicate = more than one active student whose shifts overlap on the same desk.
const hasOverlappingOccupants = (occupants, shifts) => {
  if (!occupants || occupants.length < 2) return false;
  for (let i = 0; i < occupants.length; i++) {
    for (let j = i + 1; j < occupants.length; j++) {
      if (shiftsOverlap(getStudentShift(occupants[i], shifts), getStudentShift(occupants[j], shifts))) {
        return true;
      }
    }
  }
  return false;
};

export const SeatMap = ({ onSelectStudent, onRelocateStudent, onOpenNewStudent }) => {
  const { 
    settings, students, branches, sections, seats, activeBranchId, 
    seatTypes, setSeats, shifts, getCurrentActiveAdmissions, canDeleteSeat,
    getUnsyncedShifts, plans
  } = useLibrary();

  const libId = settings.libraryId;

  // Track user-selected section for progressive selection (when 2+ sections exist)
  const [selectedSectionId, setSelectedSectionId] = useState(null);

  // Progressive Scope Resolution following the Master Library Flow
  const scope = resolveConfigurationScope({
    branches,
    sections,
    selectedBranchId: activeBranchId !== 'all' ? activeBranchId : null,
    selectedSectionId
  });

  // Reset section selection if active branch changes
  useEffect(() => {
    setSelectedSectionId(null);
  }, [activeBranchId]);

  // Filter shifts: only active, synced shifts
  const unsyncedShiftsList = React.useMemo(() => {
    return getUnsyncedShifts ? getUnsyncedShifts().map(s => s.id) : [];
  }, [getUnsyncedShifts, shifts, plans]);

  // Show shifts applicable to the selected branch, or canonical deduplicated under All Branches
  const applicableShifts = React.useMemo(() => {
    const rawShifts = (shifts || []).filter(sh => {
      if (sh.active === false) return false;
      if (unsyncedShiftsList.includes(sh.id)) return false;
      if (activeBranchId !== 'all') {
        return !sh.branchId || sh.branchId === 'all' || sh.branchId === activeBranchId;
      }
      return true;
    });
    return getCanonicalShifts(rawShifts);
  }, [shifts, unsyncedShiftsList, activeBranchId]);

  const [selectedShiftId, setSelectedShiftId] = useState('');

  // Auto-sync selectedShiftId when applicableShifts changes, preserving canonical shift name if available
  useEffect(() => {
    if (applicableShifts.length > 0) {
      const currentSelected = shifts.find(s => s.id === selectedShiftId);
      const matchingShift = currentSelected 
        ? applicableShifts.find(s => normalizeShiftName(s.name) === normalizeShiftName(currentSelected.name))
        : null;

      if (matchingShift) {
        setSelectedShiftId(matchingShift.id);
      } else if (!selectedShiftId || !applicableShifts.some(s => s.id === selectedShiftId)) {
        setSelectedShiftId(applicableShifts[0].id);
      }
    } else {
      setSelectedShiftId('');
    }
  }, [applicableShifts, selectedShiftId, shifts]);
  const [selectedDesk, setSelectedDesk] = useState(null);

  // Bulk Selection State
  const [selectionModeSectionId, setSelectionModeSectionId] = useState(null);
  const [selectedSeatIds, setSelectedSeatIds] = useState([]);
  const [showBulkMenuForSection, setShowBulkMenuForSection] = useState(null);

  // Portal-based 3-dot menu (BUG-03): keep it inside the viewport.
  const [menuTriggerEl, setMenuTriggerEl] = useState(null);
  const [bulkMenuPosition, setBulkMenuPosition] = useState(null);
  const bulkMenuRef = useRef(null);

  const closeBulkMenu = useCallback(() => {
    setShowBulkMenuForSection(null);
    setMenuTriggerEl(null);
    setBulkMenuPosition(null);
  }, []);

  // Add Seats Modal State (Post-Setup)
  const [isAddSeatsModalOpen, setIsAddSeatsModalOpen] = useState(false);
  const [targetAddBranchId, setTargetAddBranchId] = useState('');
  const [targetAddSectionId, setTargetAddSectionId] = useState('');
  const [targetAddSeatTypeId, setTargetAddSeatTypeId] = useState('');
  const [addMode, setAddMode] = useState('simple'); // 'simple' | 'row'
  const [addPrefix, setAddPrefix] = useState('');
  const [addStart, setAddStart] = useState(1);
  const [addEnd, setAddEnd] = useState(20);
  const [addRowNames, setAddRowNames] = useState('A, B');
  const [addSeatsPerRow, setAddSeatsPerRow] = useState(10);
  const [addLivePreview, setAddLivePreview] = useState([]);

  // Auto-initialize Add Desks modal fields when opened or branch changed
  useEffect(() => {
    if (isAddSeatsModalOpen) {
      const initialBranch = (activeBranchId !== 'all' ? activeBranchId : null) || (branches.length > 0 ? branches[0].id : '');
      setTargetAddBranchId(prev => prev || initialBranch);
      const branchSecs = sections.filter(s => !s.branchId || s.branchId === 'all' || s.branchId === (targetAddBranchId || initialBranch));
      setTargetAddSectionId(branchSecs[0]?.id || '');
      const branchTypes = seatTypes.filter(st => st.allocationMode === 'Fixed' && (!st.branchId || st.branchId === 'all' || st.branchId === (targetAddBranchId || initialBranch)));
      setTargetAddSeatTypeId(branchTypes[0]?.id || '');
    }
  }, [isAddSeatsModalOpen, activeBranchId, branches]);

  const handleTargetBranchChange = (newBranchId) => {
    setTargetAddBranchId(newBranchId);
    const branchSecs = sections.filter(s => !s.branchId || s.branchId === 'all' || s.branchId === newBranchId);
    setTargetAddSectionId(branchSecs[0]?.id || '');
    const branchTypes = seatTypes.filter(st => st.allocationMode === 'Fixed' && (!st.branchId || st.branchId === 'all' || st.branchId === newBranchId));
    setTargetAddSeatTypeId(branchTypes[0]?.id || '');
  };


  // Live preview for Add Seats Modal
  useEffect(() => {
    const list = [];
    if (addMode === 'simple') {
      const s = Number(addStart) || 1;
      const e = Number(addEnd) || 1;
      if (s <= e && e - s <= 200) {
        for (let i = s; i <= e; i++) list.push(`${addPrefix}${i}`);
      }
    } else {
      const rows = addRowNames.split(',').map(r => r.trim()).filter(Boolean);
      const count = Number(addSeatsPerRow) || 0;
      rows.forEach(r => {
        for (let i = 1; i <= count; i++) list.push(`${r}-${i}`);
      });
    }
    setAddLivePreview(list);
  }, [addMode, addPrefix, addStart, addEnd, addRowNames, addSeatsPerRow]);

  const branchesToRender = activeBranchId === 'all' ? branches : branches.filter(b => b.id === activeBranchId);
  const contexts = branchesToRender.length > 0 ? branchesToRender : [{ id: undefined, name: 'Main Campus' }];

  // Selection toggle
  const handleToggleSeatSelection = (seatId) => {
    setSelectedSeatIds(prev => 
      prev.includes(seatId) ? prev.filter(id => id !== seatId) : [...prev, seatId]
    );
  };

  const handleSelectAll = (sectionSeats) => {
    if (selectedSeatIds.length === sectionSeats.length) {
      setSelectedSeatIds([]);
    } else {
      setSelectedSeatIds(sectionSeats.map(s => s.id));
    }
  };

  const handleMarkStatus = (statusObj) => {
    closeBulkMenu();
    if (selectedSeatIds.length === 0) return toast.error('No seats selected.');
    setSeats(prev => prev.map(s => selectedSeatIds.includes(s.id) ? { ...s, ...statusObj } : s));
    toast.success('Updated selected seats.');
    setSelectedSeatIds([]);
    setSelectionModeSectionId(null);
  };

  const handleBulkRemove = () => {
    closeBulkMenu();
    if (selectedSeatIds.length === 0) return toast.error('No seats selected.');
    
    let removed = 0;
    let blockedOccupied = 0;

    setSeats(prev => {
      const remaining = [];
      prev.forEach(seat => {
        if (selectedSeatIds.includes(seat.id)) {
          const check = canDeleteSeat(seat.id);
          if (check.allowed) {
            removed++;
          } else {
            blockedOccupied++;
            remaining.push(seat);
          }
        } else {
          remaining.push(seat);
        }
      });
      return remaining;
    });

    if (removed > 0) toast.success(`Removed ${removed} unoccupied seats.`);
    if (blockedOccupied > 0) toast.error(`Skipped ${blockedOccupied} occupied seats. Relocate students first.`);
    setSelectedSeatIds([]);
    setSelectionModeSectionId(null);
  };

  // Keyboard Navigation (Visual Grid with getBoundingClientRect)
  const handleKeyDown = (e) => {
    if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault();
      const currentEl = e.currentTarget;
      const rect = currentEl.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      const parentGrid = currentEl.closest('.desks-grid');
      if (!parentGrid) return;
      const nodes = Array.from(parentGrid.querySelectorAll('.seat-3d'));
      
      let best = null;
      let minScore = Infinity;

      nodes.forEach(node => {
        if (node === currentEl) return;
        const nRect = node.getBoundingClientRect();
        const nx = nRect.left + nRect.width / 2;
        const ny = nRect.top + nRect.height / 2;
        
        const dx = nx - cx;
        const dy = ny - cy;
        let score = Infinity;

        if (e.key === 'ArrowRight' && dx > 0 && Math.abs(dy) < rect.height / 2) score = dx;
        else if (e.key === 'ArrowLeft' && dx < 0 && Math.abs(dy) < rect.height / 2) score = Math.abs(dx);
        else if (e.key === 'ArrowDown' && dy > 0 && Math.abs(dx) < rect.width / 2) score = dy;
        else if (e.key === 'ArrowUp' && dy < 0 && Math.abs(dx) < rect.width / 2) score = Math.abs(dy);

        if (score < minScore) { minScore = score; best = node; }
      });

      // Fallback for wrapped grid items
      if (!best) {
         nodes.forEach(node => {
          if (node === currentEl) return;
          const nRect = node.getBoundingClientRect();
          const dx = (nRect.left + nRect.width / 2) - cx;
          const dy = (nRect.top + nRect.height / 2) - cy;
          let score = Infinity;

          if (e.key === 'ArrowRight' && dx > 0) score = Math.sqrt(dx*dx + dy*dy);
          else if (e.key === 'ArrowLeft' && dx < 0) score = Math.sqrt(dx*dx + dy*dy);
          else if (e.key === 'ArrowDown' && dy > 0) score = Math.sqrt(dx*dx*2 + dy*dy);
          else if (e.key === 'ArrowUp' && dy < 0) score = Math.sqrt(dx*dx*2 + dy*dy);

          if (score < minScore) { minScore = score; best = node; }
         });
      }

      if (best) {
        if (e.shiftKey && selectionModeSectionId) {
          best.click();
        }
        best.focus();
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.currentTarget.click();
    }
  };

  // Add Generated Seats to Map
  const handleConfirmAddSeats = () => {
    const effectiveBranch = (targetAddBranchId && targetAddBranchId !== 'all')
      ? targetAddBranchId
      : ((activeBranchId !== 'all' ? activeBranchId : null) || (branches.length > 0 ? branches[0].id : undefined));

    const branchFixedTypes = seatTypes.filter(st => st.allocationMode === 'Fixed' && (!st.branchId || st.branchId === 'all' || st.branchId === effectiveBranch));
    const typeId = targetAddSeatTypeId || branchFixedTypes[0]?.id || seatTypes.find(st => st.allocationMode === 'Fixed')?.id;
    if (!typeId) return toast.error('No Fixed Seat Type available for this branch.');

    if (addLivePreview.length === 0) return toast.error('No seats to add.');

    const branchSecs = sections.filter(s => !s.branchId || s.branchId === 'all' || s.branchId === effectiveBranch);
    const targetSec = targetAddSectionId || (branchSecs[0]?.id || sections[0]?.id || undefined);
    const targetBranch = effectiveBranch;

    let added = 0;
    let skippedDuplicates = 0;
    const newItems = [];

    addLivePreview.forEach(sName => {
      const isDuplicate = seats.some(s => 
        (s.name || s.seatNumber)?.toString().toLowerCase() === sName.toLowerCase() && 
        s.sectionId === targetSec &&
        (!s.branchId || s.branchId === targetBranch)
      );
      if (isDuplicate) {
        skippedDuplicates++;
      } else {
        newItems.push({
          id: `seat-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
          name: sName,
          seatTypeId: typeId,
          sectionId: targetSec,
          branchId: targetBranch,
          libraryId: libId,
          isMaintenance: false,
          isUnavailable: false
        });
        added++;
      }
    });

    if (added > 0) {
      setSeats(prev => [...prev, ...newItems]);
      toast.success(`Added ${added} new desks! ${skippedDuplicates > 0 ? `(${skippedDuplicates} duplicates skipped)` : ''}`);
      setIsAddSeatsModalOpen(false);
    } else {
      toast.error('All entered seats already exist in this section.');
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setSelectedDesk(null);
        closeBulkMenu();
        setIsAddSeatsModalOpen(false);
        if (selectionModeSectionId) {
          setSelectionModeSectionId(null);
          setSelectedSeatIds([]);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedDesk, selectionModeSectionId, closeBulkMenu]);

  // Position the portal menu from the trigger rect, flipping when it would
  // overflow the viewport (8px safety margin).
  useLayoutEffect(() => {
    if (!menuTriggerEl || !bulkMenuRef.current) {
      setBulkMenuPosition(null);
      return;
    }

    const margin = 8;
    const triggerRect = menuTriggerEl.getBoundingClientRect();
    const menuRect = bulkMenuRef.current.getBoundingClientRect();
    const menuWidth = menuRect.width || 220;
    const menuHeight = menuRect.height || 240;

    let left = triggerRect.right - menuWidth;
    if (left < margin) left = triggerRect.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - menuWidth - margin));

    let top = triggerRect.bottom + 6;
    if (top + menuHeight > window.innerHeight - margin) {
      top = triggerRect.top - menuHeight - 6;
    }
    top = Math.max(margin, Math.min(top, window.innerHeight - menuHeight - margin));

    setBulkMenuPosition({ top, left });
  }, [showBulkMenuForSection, menuTriggerEl]);

  // Portal menu dismissal: outside pointer, Escape handled above, scroll/resize.
  useEffect(() => {
    if (!menuTriggerEl) return;

    const handleOutside = (e) => {
      if (bulkMenuRef.current?.contains(e.target)) return;
      if (menuTriggerEl?.contains(e.target)) return;
      closeBulkMenu();
    };
    const handleResize = () => closeBulkMenu();
    const handleScroll = (e) => {
      // Scrolling the menu itself must not dismiss it.
      if (bulkMenuRef.current?.contains(e.target)) return;
      closeBulkMenu();
    };

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside, { passive: true });
    document.addEventListener('click', handleOutside);
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
      document.removeEventListener('click', handleOutside);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [showBulkMenuForSection, menuTriggerEl, closeBulkMenu]);

  const selectedDeskOccupants = selectedDesk
    ? (selectedDesk.occupants?.length
        ? selectedDesk.occupants
        : (selectedDesk.occupant ? [selectedDesk.occupant] : []))
    : [];
  const selectedDeskHasDuplicate = Boolean(selectedDesk?.isDuplicate);

  return (
    <motion.div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {/* Header Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Interactive Seat Map</h2>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Real-time physical desk & capacity occupancy</p>
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Progressive Scope Display Badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#f8fafc', padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>SCOPE:</span>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--brand-primary)' }}>
              📍 {activeBranchId === 'all' 
                ? `All Branches (${branches.length || 0})` 
                : (branches.find(b => b.id === activeBranchId)?.name || 'Branch')}
              {activeBranchId !== 'all' && selectedSectionId && (
                ` → ${sections.find(s => s.id === selectedSectionId)?.name || 'Section'}`
              )}
            </span>
          </div>

          {/* Progressive Section Selector (Shown ONLY when 2+ sections exist in selected branch) */}
          {activeBranchId !== 'all' && scope.showSectionSelector && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#f1f5f9', padding: '4px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', paddingLeft: '4px', paddingRight: '4px' }}>ROOM:</span>
              <button
                type="button"
                onClick={() => setSelectedSectionId(null)}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  border: 'none',
                  background: !selectedSectionId ? 'var(--brand-primary)' : 'transparent',
                  color: !selectedSectionId ? '#fff' : 'var(--text-secondary)',
                  fontWeight: !selectedSectionId ? 700 : 500,
                  fontSize: '12px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                All Rooms
              </button>
              {scope.availableSections.map(sec => {
                const isSelected = sec.id === selectedSectionId;
                const secSeatCount = seats.filter(s => s.sectionId === sec.id && (!s.branchId || s.branchId === 'all' || s.branchId === activeBranchId)).length;
                return (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => setSelectedSectionId(sec.id)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '6px',
                      border: 'none',
                      background: isSelected ? 'var(--brand-primary)' : 'transparent',
                      color: isSelected ? '#fff' : 'var(--text-secondary)',
                      fontWeight: isSelected ? 700 : 500,
                      fontSize: '12px',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {sec.name} {secSeatCount > 0 ? `(${secSeatCount})` : ''}
                  </button>
                );
              })}
            </div>
          )}

          {/* Shift Filter Tabs (Strictly valid, active, scope-matched shifts) */}
          <div style={{ display: 'flex', gap: '4px', background: '#fff', padding: '4px', borderRadius: '8px', border: '1px solid var(--border-light)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', flexWrap: 'wrap' }}>
            {applicableShifts.length === 0 ? (
              <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', padding: '6px 12px' }}>
                No active shifts in this scope
              </span>
            ) : (
              applicableShifts.map(shift => (
                <button
                  key={shift.id}
                  type="button"
                  onClick={() => setSelectedShiftId(shift.id)}
                  style={{
                    position: 'relative', padding: '6px 14px', borderRadius: '6px', border: 'none', background: 'transparent',
                    color: selectedShiftId === shift.id ? '#fff' : 'var(--text-secondary)',
                    fontWeight: 600, fontSize: '13px', cursor: 'pointer', outline: 'none'
                  }}
                >
                  {selectedShiftId === shift.id && (
                    <motion.div layoutId="shiftActivePill" style={{ position: 'absolute', inset: 0, background: 'var(--brand-primary)', borderRadius: '6px', zIndex: -1 }} transition={{ type: 'spring', stiffness: 350, damping: 30 }} />
                  )}
                  <span>{shift.name}</span>
                </button>
              ))
            )}
          </div>

          <button 
            className="btn btn-primary" 
            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}
            onClick={() => {
              const currentBranch = activeBranchId !== 'all' ? activeBranchId : (branches[0]?.id || undefined);
              const branchSecs = sections.filter(s => !s.branchId || s.branchId === 'all' || s.branchId === currentBranch);
              setTargetAddSectionId(selectedSectionId || branchSecs[0]?.id || (sections[0]?.id || ''));
              const branchFixedTypes = seatTypes.filter(st => st.allocationMode === 'Fixed' && (!st.branchId || st.branchId === 'all' || st.branchId === currentBranch));
              setTargetAddSeatTypeId(branchFixedTypes[0]?.id || seatTypes.find(st => st.allocationMode === 'Fixed')?.id || '');
              setIsAddSeatsModalOpen(true);
            }}
          >
            <Plus size={15} /> Add Desks
          </button>
        </div>
      </div>

      {/* Zero Seats Global Empty State */}
      {seats.length === 0 && (
        <div style={{ background: '#fff', border: '1px dashed var(--border-light)', borderRadius: '12px', padding: '48px 24px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--brand-primary)' }}>
            <Plus size={28} />
          </div>
          <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>No seats added yet</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', maxWidth: '420px', margin: 0 }}>
            Set up your seats to start assigning students to physical desks. You can generate them in bulk or row-by-row.
          </p>
          <button className="btn btn-primary" style={{ marginTop: '8px' }} onClick={() => setIsAddSeatsModalOpen(true)}>
            <Plus size={16} /> + Add Seats
          </button>
        </div>
      )}

      {/* Grid of Sections */}
      {contexts.map(branch => {
        const branchSections = sections
          .filter(s => !s.branchId || s.branchId === branch.id || s.branchId === 'all')
          .slice()
          .sort((a, b) => (a.order || 0) - (b.order || 0) || (a.name || '').localeCompare(b.name || '', undefined, { numeric: true }));

        // When viewing a specific branch and user picked a room, show only that room.
        // Otherwise, show all sections belonging to this branch.
        const renderSections = (activeBranchId !== 'all' && selectedSectionId)
          ? branchSections.filter(s => s.id === selectedSectionId)
          : (branchSections.length > 0 ? branchSections : [{ id: undefined, name: 'Main Section' }]);

        return (
          <div key={branch.id || 'lib'} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {activeBranchId === 'all' && branches.length > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '1px solid var(--border-light)', marginTop: '8px' }}>
                <Building2 size={18} color="var(--brand-primary)" />
                <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                  {branch.name}
                </h3>
              </div>
            )}
            {renderSections.map(section => {
              // Determine effective shift for this section
              const sectionShifts = applicableShifts.filter(sh => matchesScope(sh, branch.id, section.id));
              const effectiveShiftId = sectionShifts.some(s => s.id === selectedShiftId) 
                ? selectedShiftId 
                : (sectionShifts[0]?.id || selectedShiftId);

              // Exact seat-number occupancy, scoped to this branch + section + shift.
              const occupancyMap = buildSeatOccupancy(students, shifts, {
                libraryId: libId,
                branchId: branch.id,
                sectionId: section.id,
                shiftId: effectiveShiftId
              });
              const isSeatKeyOccupied = (seat) => (occupancyMap.get(getSeatKey(seat)) || []).length > 0;


              const rawSectionSeats = seats.filter(s => {
                const matchesBranch = !s.branchId || s.branchId === 'all' || s.branchId === branch.id;
                if (!matchesBranch) return false;

                // Resolve effective section within this branch so seats never disappear
                let effectiveSecId = s.sectionId;
                const isSecInBranch = effectiveSecId && branchSections.some(bs => bs.id === effectiveSecId);
                if (!isSecInBranch && branchSections.length > 0) {
                  const origSec = sections.find(sec => sec.id === effectiveSecId);
                  const sameNameSec = origSec ? branchSections.find(bs => bs.name?.toLowerCase() === origSec.name?.toLowerCase()) : null;
                  effectiveSecId = sameNameSec ? sameNameSec.id : branchSections[0]?.id;
                }

                if (section.id) return effectiveSecId === section.id;
                return !effectiveSecId;
              });

              // Deduplicate seats by seat name/number, prioritizing occupied/maintenance seats
              const dedupedMap = new Map();
              rawSectionSeats.forEach(s => {
                const sName = String(s.name || s.seatNumber || s.id);
                if (!dedupedMap.has(sName)) {
                  dedupedMap.set(sName, s);
                } else {
                  const existing = dedupedMap.get(sName);
                  const isCurOccupied = isSeatKeyOccupied(s);
                  const isExistOccupied = isSeatKeyOccupied(existing);
                  if ((isCurOccupied || s.isMaintenance || s.isUnavailable) && !isExistOccupied && !existing.isMaintenance && !existing.isUnavailable) {
                    dedupedMap.set(sName, s);
                  }
                }
              });

              // Sort seats in ascending numerical order: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10...
              const sectionSeats = Array.from(dedupedMap.values()).sort((a, b) => {
                const nameA = String(a.name || a.seatNumber || '');
                const nameB = String(b.name || b.seatNumber || '');
                return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
              });

              const sectionSeatTypes = seatTypes.filter(st => {
                const matchesBranch = !st.branchId || st.branchId === 'all' || st.branchId === branch.id;
                if (!matchesBranch) return false;
                if (section.id) return !st.sectionId || st.sectionId === section.id;
                return true;
              });
              const nonFixedTypes = sectionSeatTypes.filter(st => st.allocationMode === 'Non-Fixed');


              // Accurate Count Calculations
              const totalSeats = sectionSeats.length;
              let occupiedCount = 0;
              let maintenanceCount = 0;
              let unavailableCount = 0;
              let duplicateSeatCount = 0;

              sectionSeats.forEach(seat => {
                const occupants = occupancyMap.get(getSeatKey(seat)) || [];
                if (seat.isUnavailable) unavailableCount++;
                else if (seat.isMaintenance) maintenanceCount++;
                else if (occupants.length > 0) occupiedCount++;
                if (hasOverlappingOccupants(occupants, shifts)) duplicateSeatCount++;
              });

              const vacantEligibleCount = Math.max(0, totalSeats - occupiedCount - maintenanceCount - unavailableCount);

              // Non-fixed stats
              const nonFixedStats = nonFixedTypes.map(st => {
                const activeCount = getCurrentActiveAdmissions(libId, branch.id, section.id, st.id, selectedShiftId);
                return { name: st.name, count: activeCount, max: st.maximumStudentsAllowed };
              });

              if (sectionSeats.length === 0 && nonFixedStats.length === 0) return null;

              return (
                <div key={`${branch.id || 'lib'}-${section.id || 'main'}`} className="premium-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Section Title & KPI Legend Bar */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                    <div>
                      <h3 style={{ fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {activeBranchId === 'all' ? `${branch.name} — ${section.name}` : (branches.length > 1 ? `${branch.name} — ${section.name}` : section.name)}
                      </h3>

                      {/* Precise Counts Breakdown */}
                      <div style={{ display: 'flex', gap: '16px', marginTop: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#22c55e' }} />
                          <span style={{ fontSize: '12px', fontWeight: 600, color: '#15803d' }}>
                            Vacant & Eligible ({vacantEligibleCount})
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#3b82f6' }} />
                          <span style={{ fontSize: '12px', fontWeight: 500, color: '#1d4ed8' }}>Occupied Male</span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#ec4899' }} />
                          <span style={{ fontSize: '12px', fontWeight: 500, color: '#be185d' }}>Occupied Female</span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#eab308' }} />
                          <span style={{ fontSize: '12px', fontWeight: 500, color: '#a16207' }}>Maintenance ({maintenanceCount})</span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#94a3b8' }} />
                          <span style={{ fontSize: '12px', fontWeight: 500, color: '#475569' }}>Unavailable ({unavailableCount})</span>
                        </div>

                        {nonFixedStats.map(ns => (
                          <div key={ns.name} style={{ background: '#f0f9ff', border: '1px solid #bae6fd', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 600, color: '#0369a1' }}>
                            {ns.name}: {ns.count} {ns.max ? `/ ${ns.max}` : '(Unlimited)'}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Bold, high-contrast More Actions 3-dot button */}
                    <div style={{ position: 'relative' }}>
                      <button 
                        type="button"
                        className="btn btn-ghost" 
                        style={{ 
                          width: '36px', height: '36px', padding: 0, borderRadius: '8px', 
                          background: menuTriggerEl && showBulkMenuForSection === section.id ? '#e2e8f0' : '#f1f5f9', 
                          border: '1px solid #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: 'pointer', transition: 'all 0.15s ease'
                        }} 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (showBulkMenuForSection === section.id && menuTriggerEl === e.currentTarget) {
                            closeBulkMenu();
                          } else {
                            setMenuTriggerEl(e.currentTarget);
                            setShowBulkMenuForSection(section.id);
                          }
                        }}
                        title="Section Seat Actions"
                        aria-label="Section Seat Actions"
                        aria-haspopup="menu"
                        aria-expanded={showBulkMenuForSection === section.id}
                      >
                        <MoreVertical size={20} strokeWidth={2.8} color="#0f172a" />
                      </button>

                      {showBulkMenuForSection === section.id && ReactDOM.createPortal(
                        <div
                          ref={bulkMenuRef}
                          className="dropdown-menu"
                          role="menu"
                          style={{
                            position: 'fixed',
                            top: bulkMenuPosition ? bulkMenuPosition.top : 0,
                            left: bulkMenuPosition ? bulkMenuPosition.left : 0,
                            right: 'auto',
                            marginTop: 0,
                            zIndex: 2000,
                            maxHeight: 'calc(100vh - 16px)',
                            maxWidth: 'calc(100vw - 16px)',
                            overflowY: 'auto',
                            visibility: bulkMenuPosition ? 'visible' : 'hidden'
                          }}
                        >
                          <button type="button" role="menuitem" className="dropdown-item" onClick={() => { setSelectionModeSectionId(section.id); closeBulkMenu(); }}>
                            <CheckCircle2 size={15} color="#2563eb" />
                            <span>Select Desks</span>
                          </button>
                          <button type="button" role="menuitem" className="dropdown-item" onClick={() => { setSelectionModeSectionId(section.id); handleSelectAll(sectionSeats); closeBulkMenu(); }}>
                            <CheckCircle2 size={15} color="#16a34a" />
                            <span>Select All Desks ({sectionSeats.length})</span>
                          </button>
                          <div className="dropdown-divider" />
                          <div className="dropdown-header">
                            Bulk Status Actions
                          </div>
                          <button type="button" role="menuitem" className="dropdown-item" onClick={() => handleMarkStatus({ isMaintenance: true, isUnavailable: false })}>
                            <Settings size={15} color="#d97706" />
                            <span>Mark Maintenance</span>
                          </button>
                          <button type="button" role="menuitem" className="dropdown-item" onClick={() => handleMarkStatus({ isMaintenance: false, isUnavailable: false })}>
                            <CheckCircle2 size={15} color="#16a34a" />
                            <span>Mark Available</span>
                          </button>
                          <button type="button" role="menuitem" className="dropdown-item" onClick={() => handleMarkStatus({ isUnavailable: true, isMaintenance: false })}>
                            <Ban size={15} color="#64748b" />
                            <span>Mark Unavailable</span>
                          </button>
                          <div className="dropdown-divider" />
                          <button type="button" role="menuitem" className="dropdown-item danger" onClick={handleBulkRemove}>
                            <Trash2 size={15} />
                            <span>Remove Unoccupied Desks</span>
                          </button>
                        </div>,
                        document.body
                      )}
                    </div>
                  </div>

                  {duplicateSeatCount > 0 && (
                    <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '8px 12px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600 }}>
                      <AlertCircle size={16} />
                      <span>
                        Duplicate occupancy: {duplicateSeatCount} desk{duplicateSeatCount === 1 ? '' : 's'} have more than one active student in this shift. Click the desk to review.
                      </span>
                    </div>
                  )}

                  {/* Selection Mode Notice Bar */}
                  {selectionModeSectionId === section.id && (
                    <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '8px 16px', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#16a34a' }}>
                        {selectedSeatIds.length} Desks Selected
                      </span>
                      <button className="btn btn-ghost" style={{ fontSize: '12px', padding: '4px 8px' }} onClick={() => { setSelectionModeSectionId(null); setSelectedSeatIds([]); }}>
                        Cancel Selection
                      </button>
                    </div>
                  )}

                  {/* 3D Seat Grid Layout */}
                  <div className="seat-map-container" style={{ minHeight: '120px' }}>
                    <div className="seat-grid-3d">
                      {sectionSeats.map((seat, idx) => {
                        const occupants = occupancyMap.get(getSeatKey(seat)) || [];
                        const occupant = occupants[0] || null;
                        const isOccupied = occupants.length > 0;
                        const isDuplicate = hasOverlappingOccupants(occupants, shifts);
                        const isSelected = selectedSeatIds.includes(seat.id);

                        // Color rules:
                        // Available: Green
                        // Occupied Male: Blue
                        // Occupied Female: Pink
                        // Maintenance: Yellow (overrides gender)
                        // Unavailable: Gray (overrides gender)
                        let statusClass = 'seat-available';
                        if (seat.isUnavailable) {
                          statusClass = 'seat-unavailable';
                        } else if (seat.isMaintenance) {
                          statusClass = 'seat-maintenance';
                        } else if (isOccupied) {
                          statusClass = occupant.gender === 'Female' ? 'seat-occupied-female' : 'seat-occupied-male';
                        }

                        // Selected state: bold highlighted border (no solid blue fill)
                        if (isSelected) {
                          statusClass += ' seat-selected-outline';
                        }

                        return (
                          <motion.div
                            key={seat.id}
                            className={`seat-3d ${statusClass}`}
                            tabIndex={0}
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: Math.min(idx * 0.005, 0.3) }}
                            onKeyDown={handleKeyDown}
                            onClick={() => {
                              if (selectionModeSectionId === section.id) {
                                handleToggleSeatSelection(seat.id);
                              } else {
                                setSelectedDesk({ seat, occupant, occupants, isDuplicate });
                              }
                            }}
                          >
                            <div className="seat-surface">
                              <span className="seat-number">{seat.name}</span>
                            </div>
                            <div className="seat-front"></div>
                            <div className="seat-right"></div>
                            <div className="seat-shadow"></div>

                            {isDuplicate && (
                              <div
                                title="Multiple active students are assigned to this desk."
                                style={{ position: 'absolute', top: '-6px', left: '-6px', width: '18px', height: '18px', background: '#dc2626', color: '#fff', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}
                              >
                                <AlertCircle size={12} strokeWidth={3} />
                              </div>
                            )}

                            {isSelected && (
                              <div style={{ position: 'absolute', top: '-6px', right: '-6px', background: '#16a34a', color: '#fff', borderRadius: '50%', padding: '2px', zIndex: 10 }}>
                                <CheckCircle2 size={12} strokeWidth={3} />
                              </div>
                            )}
                          </motion.div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Desk Details Inspection Modal */}
      <AnimatePresence>
        {selectedDesk && (
          <div className="modal-overlay" onClick={() => setSelectedDesk(null)}>
            <motion.div className="modal-content" onClick={e => e.stopPropagation()} initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} style={{ maxWidth: '440px' }}>
              <div className="modal-header">
                <h3 style={{ fontSize: '18px', fontWeight: 600 }}>Desk {selectedDesk.seat.name} Details</h3>
                <button className="btn-ghost" onClick={() => setSelectedDesk(null)}><X size={20} /></button>
              </div>
              <div className="modal-body">
                {selectedDesk.seat.isMaintenance || selectedDesk.seat.isUnavailable ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ textAlign: 'center', padding: '16px 0' }}>
                      {selectedDesk.seat.isMaintenance
                        ? <Settings size={42} color="#d97706" style={{ margin: '0 auto 12px' }} />
                        : <Ban size={42} color="#64748b" style={{ margin: '0 auto 12px' }} />}
                      <h4 style={{ fontSize: '16px', fontWeight: 600 }}>
                        {selectedDesk.seat.isMaintenance ? 'Desk Under Maintenance' : 'Desk Unavailable'}
                      </h4>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px' }}>
                        This desk is not available for student allocation.
                      </p>
                    </div>
                    {selectedDeskOccupants.length > 0 && (
                      <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '10px 12px', borderRadius: '8px', display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '13px', fontWeight: 600 }}>
                        <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
                        <span>
                          Active student still assigned: {selectedDeskOccupants.map(o => o.name || o.id).join(', ')}. Relocate them before using this desk.
                        </span>
                      </div>
                    )}
                  </div>
                ) : selectedDeskOccupants.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {selectedDeskHasDuplicate && (
                      <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '10px 12px', borderRadius: '8px', display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '13px', fontWeight: 600 }}>
                        <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
                        <span>Duplicate occupancy: more than one active student is assigned to this desk in overlapping shifts.</span>
                      </div>
                    )}
                    {selectedDeskOccupants.map((occupant, index) => {
                      const shiftLabel = occupant.shift || getStudentShift(occupant, shifts).name || '—';
                      return (
                        <div
                          key={occupant.id || index}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                            paddingBottom: index < selectedDeskOccupants.length - 1 ? '16px' : 0,
                            borderBottom: index < selectedDeskOccupants.length - 1 ? '1px solid var(--border-light)' : 'none'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: 'var(--brand-primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', fontWeight: 700 }}>
                              {String(occupant.name || '?').charAt(0)}
                            </div>
                            <div>
                              <h4 style={{ fontSize: '16px', fontWeight: 700 }}>{occupant.name || 'Unnamed student'}</h4>
                              <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                                ID: {occupant.id || '—'}{occupant.phone ? ` • ${occupant.phone}` : ''}
                              </div>
                            </div>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', background: '#f8fafc', padding: '12px', borderRadius: '8px' }}>
                            <div>
                              <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>SHIFT</span>
                              <div style={{ fontSize: '14px', fontWeight: 600, marginTop: '2px' }}>{shiftLabel}</div>
                            </div>
                            <div>
                              <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>EXPIRY DATE</span>
                              <div style={{ fontSize: '14px', fontWeight: 600, color: '#16a34a', marginTop: '2px' }}>{occupant.expiryDate || '—'}</div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                            {onSelectStudent && (
                              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => {
                                onSelectStudent(occupant);
                                setSelectedDesk(null);
                              }}>
                                View Student
                              </button>
                            )}
                            {onRelocateStudent && (
                              <button className="btn btn-ghost" style={{ border: '1px solid var(--border-light)' }} onClick={() => {
                                onRelocateStudent(occupant);
                                setSelectedDesk(null);
                              }}>
                                Relocate Desk
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '24px 0' }}>
                    <CheckCircle2 size={42} color="#16a34a" style={{ margin: '0 auto 12px' }} />
                    <h4 style={{ fontSize: '16px', fontWeight: 600 }}>Desk is Available</h4>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px' }}>
                      This desk is currently unoccupied for the selected shift.
                    </p>
                    {onOpenNewStudent && (
                      <button className="btn btn-primary" style={{ marginTop: '16px' }} onClick={() => {
                        setSelectedDesk(null);
                        onOpenNewStudent();
                      }}>
                        Admit Student to this Desk
                      </button>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Post-Setup Add Desks Modal */}
      <AnimatePresence>
        {isAddSeatsModalOpen && (
          <div className="modal-overlay" onClick={() => setIsAddSeatsModalOpen(false)}>
            <motion.div className="modal-content" onClick={e => e.stopPropagation()} initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} style={{ maxWidth: '580px' }}>
              <div className="modal-header">
                <h3 style={{ fontSize: '18px', fontWeight: 700 }}>+ Add Desks to Seat Map</h3>
                <button className="btn-ghost" onClick={() => setIsAddSeatsModalOpen(false)}><X size={20} /></button>
              </div>

              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {activeBranchId === 'all' && branches.length > 1 && (
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '12px' }}>Branch *</label>
                    <select 
                      className="form-select" 
                      value={targetAddBranchId || branches[0]?.id || ''} 
                      onChange={e => handleTargetBranchChange(e.target.value)}
                    >
                      {branches.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '12px' }}>Seat Type *</label>
                    <select className="form-select" value={targetAddSeatTypeId} onChange={e => setTargetAddSeatTypeId(e.target.value)}>
                      {seatTypes
                        .filter(st => {
                          const effBranch = (targetAddBranchId && targetAddBranchId !== 'all') ? targetAddBranchId : (activeBranchId !== 'all' ? activeBranchId : branches[0]?.id);
                          return st.allocationMode === 'Fixed' && (!st.branchId || st.branchId === 'all' || st.branchId === effBranch);
                        })
                        .map(st => (
                          <option key={st.id} value={st.id}>
                            {st.name}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '12px' }}>Section</label>
                    <select className="form-select" value={targetAddSectionId} onChange={e => setTargetAddSectionId(e.target.value)}>
                      {sections
                        .filter(s => {
                          const effBranch = (targetAddBranchId && targetAddBranchId !== 'all') ? targetAddBranchId : (activeBranchId !== 'all' ? activeBranchId : branches[0]?.id);
                          return !s.branchId || s.branchId === 'all' || s.branchId === effBranch;
                        })
                        .map(s => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: '12px' }}>Setup Method</label>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <button 
                      type="button" 
                      className={`btn ${addMode === 'simple' ? 'btn-primary' : 'btn-ghost'}`}
                      style={{ fontSize: '12px', padding: '6px 14px', border: '1px solid var(--border-light)' }}
                      onClick={() => setAddMode('simple')}
                    >
                      Simple Numbering
                    </button>
                    <button 
                      type="button" 
                      className={`btn ${addMode === 'row' ? 'btn-primary' : 'btn-ghost'}`}
                      style={{ fontSize: '12px', padding: '6px 14px', border: '1px solid var(--border-light)' }}
                      onClick={() => setAddMode('row')}
                    >
                      Row Based
                    </button>
                  </div>
                </div>

                {addMode === 'simple' ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', background: '#f8fafc', padding: '12px', borderRadius: '8px' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: '11px' }}>Prefix (Optional)</label>
                      <input className="form-input" placeholder="e.g. S- or empty" value={addPrefix} onChange={e => setAddPrefix(e.target.value)} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: '11px' }}>Start</label>
                      <NumericInput className="form-input" value={addStart} onChange={e => setAddStart(Number(e.target.value))} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: '11px' }}>End</label>
                      <NumericInput className="form-input" value={addEnd} onChange={e => setAddEnd(Number(e.target.value))} />
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px', background: '#f8fafc', padding: '12px', borderRadius: '8px' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: '11px' }}>Row Names</label>
                      <input className="form-input" placeholder="e.g. E, F" value={addRowNames} onChange={e => setAddRowNames(e.target.value)} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: '11px' }}>Seats Per Row</label>
                      <NumericInput className="form-input" value={addSeatsPerRow} onChange={e => setAddSeatsPerRow(Number(e.target.value))} />
                    </div>
                  </div>
                )}

                {/* Live Preview */}
                <div style={{ background: '#fff', border: '1px solid var(--border-light)', borderRadius: '8px', padding: '12px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                    Preview ({addLivePreview.length} desks to add):
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', maxHeight: '90px', overflowY: 'auto' }}>
                    {addLivePreview.map((name, i) => (
                      <span key={i} style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="modal-footer" style={{ borderTop: '1px solid var(--border-light)', padding: '16px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setIsAddSeatsModalOpen(false)}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={handleConfirmAddSeats}>
                  + Add {addLivePreview.length} Desks
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
