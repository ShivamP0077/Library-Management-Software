import React, { useState, useEffect } from 'react';
import { useLibrary } from '../context/LibraryContext';
import { Grid, Clock, CheckCircle2, UserCheck, ShieldAlert, X, MoreVertical, Plus, Trash2, Settings, Ban } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshButton } from './RefreshButton';
import { NumericInput } from './NumericInput';
import toast from 'react-hot-toast';

export const SeatMap = ({ onSelectStudent, onOpenNewStudent, onRelocateStudent }) => {
  const { students, branches, activeBranchId, seatTypes, setBranches, shifts, getBlockOccupancyMap } = useLibrary();

  const [selectedShiftId, setSelectedShiftId] = useState(shifts[0]?.id || 'sh1');
  const [selectedDesk, setSelectedDesk] = useState(null);
  
  // Selection State for Bulk Actions
  const [selectionModeBlockId, setSelectionModeBlockId] = useState(null);
  const [selectedSeatIds, setSelectedSeatIds] = useState([]);
  const [showBulkMenuForBlock, setShowBulkMenuForBlock] = useState(null);

  // Bulk Add Modal
  const [showBulkAddModal, setShowBulkAddModal] = useState(null); // blockId

  const branchesToRender = activeBranchId === 'all' ? branches : branches.filter(b => b.id === activeBranchId);

  // -- Bulk Action Helpers --
  
  const handleToggleSeatSelection = (seatId) => {
    setSelectedSeatIds(prev => 
      prev.includes(seatId) ? prev.filter(id => id !== seatId) : [...prev, seatId]
    );
  };

  const handleSelectAll = (blockSeats) => {
    if (selectedSeatIds.length === blockSeats.length) {
      setSelectedSeatIds([]);
    } else {
      setSelectedSeatIds(blockSeats.map(s => s.id));
    }
  };

  const updateSeatsInBlock = (branchId, blockId, modifierFunc) => {
    setBranches(prev => prev.map(b => {
      if (b.id !== branchId) return b;
      return {
        ...b,
        blocks: b.blocks.map(blk => {
          if (blk.id !== blockId) return blk;
          return { ...blk, seats: modifierFunc(blk.seats || []) };
        })
      };
    }));
  };

  const handleMarkStatus = (branchId, blockId, statusObj) => {
    if (selectedSeatIds.length === 0) return toast.error('No seats selected.');
    updateSeatsInBlock(branchId, blockId, (seats) => {
      return seats.map(s => selectedSeatIds.includes(s.id) ? { ...s, ...statusObj } : s);
    });
    toast.success('Seats updated successfully.');
    setSelectedSeatIds([]);
    setSelectionModeBlockId(null);
  };

  const [bulkRemoveResult, setBulkRemoveResult] = useState(null);
  const [lastSelectedSeatId, setLastSelectedSeatId] = useState(null);

  const handleSeatClick = (e, seat, blockSeats) => {
    if (selectionModeBlockId !== seat.blockId) return;

    if (e.shiftKey && lastSelectedSeatId) {
      const currentIndex = blockSeats.findIndex(s => s.id === seat.id);
      const lastIndex = blockSeats.findIndex(s => s.id === lastSelectedSeatId);
      
      if (currentIndex !== -1 && lastIndex !== -1) {
        const start = Math.min(currentIndex, lastIndex);
        const end = Math.max(currentIndex, lastIndex);
        const rangeIds = blockSeats.slice(start, end + 1).map(s => s.id);
        
        const newSelection = [...selectedSeatIds];
        rangeIds.forEach(id => {
          if (!newSelection.includes(id)) newSelection.push(id);
        });
        setSelectedSeatIds(newSelection);
        setLastSelectedSeatId(seat.id);
        return;
      }
    }
    
    handleToggleSeatSelection(seat.id);
    setLastSelectedSeatId(seat.id);
  };

  const handleBulkRemove = (branchId, blockId, seatOccupancyMap) => {
    if (selectedSeatIds.length === 0) return toast.error('No seats selected.');
    
    // Check occupancy
    const seatsToRemove = [];
    const skippedSeats = [];

    updateSeatsInBlock(branchId, blockId, (seats) => {
      const newSeats = [...seats];
      selectedSeatIds.forEach(seatId => {
        const seat = seats.find(s => s.id === seatId);
        if (seat) {
          const occupant = seatOccupancyMap[seat.name];
          if (occupant) {
            skippedSeats.push({ seat, occupant });
          } else {
            seatsToRemove.push(seat.id);
          }
        }
      });
      return newSeats.filter(s => !seatsToRemove.includes(s.id));
    });

    setBulkRemoveResult({ removedCount: seatsToRemove.length, skippedSeats });
    
    setSelectedSeatIds([]);
    setSelectionModeBlockId(null);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setSelectedDesk(null);
        setShowBulkMenuForBlock(null);
        if (selectionModeBlockId) {
          setSelectionModeBlockId(null);
          setSelectedSeatIds([]);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedDesk, selectionModeBlockId]);

  return (
    <motion.div 
      style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      
      {/* Header Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Interactive Desk Map</h2>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
            Real-time occupancy {activeBranchId === 'all' ? 'across All Branches' : `for ${branchesToRender[0]?.name}`}
          </p>
        </div>

        {/* Shift Filter Tabs */}
        <div style={{ display: 'flex', gap: '8px', background: 'var(--bg-surface)', padding: '6px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-light)', boxShadow: 'var(--shadow-sm)' }}>
          {shifts.map(shift => (
            <button
              key={shift.id}
              onClick={() => setSelectedShiftId(shift.id)}
              style={{
                position: 'relative',
                padding: '8px 16px',
                borderRadius: '6px',
                border: 'none',
                background: 'transparent',
                color: selectedShiftId === shift.id ? 'white' : 'var(--text-secondary)',
                fontWeight: 500,
                fontSize: '13px',
                cursor: 'pointer',
                outline: 'none'
              }}
            >
              {selectedShiftId === shift.id && (
                <motion.div
                  layoutId="shiftIndicator"
                  style={{ position: 'absolute', inset: 0, background: 'var(--brand-primary)', borderRadius: '6px', zIndex: -1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                />
              )}
              {shift.name}
            </button>
          ))}
        </div>
        <RefreshButton />
      </div>

      {/* Interactive 3D Seat Map Grids */}
      {branchesToRender.map(branch => (
        <div key={branch.id}>
          {branch.blocks?.map(block => {
            const seats = block.seats || [];
            const blockOccupancy = getBlockOccupancyMap(branch.id, block.id, selectedShiftId);
            const seatOccupancyMap = blockOccupancy.fixed;
            const nonFixedStudents = blockOccupancy.nonFixed;

            const occupiedCount = Object.keys(seatOccupancyMap).length;
            const availableCount = Math.max(0, seats.length - occupiedCount);

            return (
              <div key={block.id} className="premium-card" style={{ display: 'flex', flexDirection: 'column', gap: '24px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                  <div>
                    <h3 style={{ fontSize: '18px', fontWeight: 600 }}>{branch.name} - {block.name}</h3>
                    <div style={{ display: 'flex', gap: '16px', marginTop: '12px', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '16px', height: '16px', borderRadius: '4px', background: '#f0fdf4', border: '1px solid #bbf7d0' }} />
                        <span style={{ fontSize: '12px', fontWeight: 500 }}>Available ({availableCount})</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '16px', height: '16px', borderRadius: '4px', background: '#eff6ff', border: '1px solid #93c5fd' }} />
                        <span style={{ fontSize: '12px', fontWeight: 500 }}>Male Occupied</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '16px', height: '16px', borderRadius: '4px', background: '#fdf2f8', border: '1px solid #f9a8d4' }} />
                        <span style={{ fontSize: '12px', fontWeight: 500 }}>Female Occupied</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '16px', height: '16px', borderRadius: '4px', background: '#fef08a', border: '1px solid #fde047' }} />
                        <span style={{ fontSize: '12px', fontWeight: 500 }}>Maintenance</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '16px', height: '16px', borderRadius: '4px', background: '#f8fafc', border: '1px solid #e2e8f0' }} />
                        <span style={{ fontSize: '12px', fontWeight: 500 }}>Unavailable</span>
                      </div>
                      {nonFixedStudents.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--brand-primary)' }}>Non-Fixed Active ({nonFixedStudents.length})</span>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div style={{ position: 'relative' }}>
                    <button 
                      className="btn btn-ghost" 
                      style={{ padding: '8px', fontWeight: 'bold' }} 
                      onClick={() => setShowBulkMenuForBlock(showBulkMenuForBlock === block.id ? null : block.id)}
                    >
                      <MoreVertical size={24} strokeWidth={3} color="var(--text-primary)" />
                    </button>

                    {/* Unified Actions Dropdown */}
                    {showBulkMenuForBlock === block.id && (
                      <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: '8px', background: 'white', borderRadius: '8px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', border: '1px solid #e2e8f0', zIndex: 50, minWidth: '220px', overflow: 'hidden' }}>
                        <button className="dropdown-item" onClick={() => { setSelectionModeBlockId(block.id); setShowBulkMenuForBlock(null); }}>
                          <CheckCircle2 size={16} /> Select Seats
                        </button>
                        <button className="dropdown-item" onClick={() => { setSelectionModeBlockId(block.id); handleSelectAll(seats); setShowBulkMenuForBlock(null); }}>
                          <CheckCircle2 size={16} /> Select All
                        </button>
                        
                        <div style={{ padding: '8px 16px', background: '#f8fafc', fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.05em', borderTop: '1px solid var(--border-light)', borderBottom: '1px solid var(--border-light)' }}>
                          BULK ACTIONS
                        </div>
                        
                        <button className="dropdown-item" onClick={() => { setShowBulkAddModal(block.id); setShowBulkMenuForBlock(null); }}>
                          <Plus size={16} /> Add Seats
                        </button>
                        <button className="dropdown-item" style={{ color: '#ef4444' }} onClick={() => handleBulkRemove(branch.id, block.id, seatOccupancyMap)}>
                          <Trash2 size={16} /> Remove Seats
                        </button>
                        <button className="dropdown-item" onClick={() => handleMarkStatus(branch.id, block.id, { isMaintenance: true, isUnavailable: false })}>
                          <Settings size={16} /> Maintenance
                        </button>
                        <button className="dropdown-item" onClick={() => handleMarkStatus(branch.id, block.id, { isMaintenance: false, isUnavailable: false })}>
                          <CheckCircle2 size={16} /> Available
                        </button>
                        <button className="dropdown-item" onClick={() => handleMarkStatus(branch.id, block.id, { isUnavailable: true, isMaintenance: false })}>
                          <Ban size={16} /> Unavailable
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {selectionModeBlockId === block.id && (
                  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '8px 16px', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: '#16a34a' }}>{selectedSeatIds.length} Seats Selected</span>
                    <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: '13px' }} onClick={() => { setSelectionModeBlockId(null); setSelectedSeatIds([]); }}>Cancel Selection</button>
                  </div>
                )}

                <div className="seat-map-container">
                  {seats.length === 0 ? (
                    <div style={{ padding: '64px 24px', textAlign: 'center', background: '#f8fafc', borderRadius: '12px', border: '1px dashed #cbd5e1' }}>
                      <div style={{ width: '64px', height: '64px', background: '#e2e8f0', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: '#64748b' }}>
                        <Grid size={32} />
                      </div>
                      <h4 style={{ fontSize: '18px', fontWeight: 600, color: '#0f172a', marginBottom: '8px' }}>No seats added yet</h4>
                      <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '24px', maxWidth: '400px', margin: '0 auto 24px' }}>
                        Set up your seats to start assigning students. You can configure custom numbering and layouts.
                      </p>
                      <button className="btn btn-primary" onClick={() => setShowBulkAddModal(block.id)}>
                        <Plus size={18} /> Add Seats
                      </button>
                    </div>
                  ) : (
                    <div className="seat-grid-3d">
                    {seats.map((seat, i) => {
                      const occupant = seatOccupancyMap[seat.name];
                      const isOccupied = Boolean(occupant);
                      const isSelected = selectedSeatIds.includes(seat.id);
                      
                      let seatStatusClass = 'seat-available';
                      if (seat.isUnavailable) {
                        seatStatusClass = 'seat-unavailable';
                      } else if (seat.isMaintenance) {
                        seatStatusClass = 'seat-maintenance';
                      } else if (isOccupied) {
                        if (occupant.status === 'Expired') {
                          seatStatusClass = 'seat-expired';
                        } else if (occupant.status === 'Expiring Soon') {
                          seatStatusClass = 'seat-expiring';
                        } else {
                          seatStatusClass = occupant.gender === 'Female' ? 'seat-occupied-female' : 'seat-occupied-male';
                        }
                      }
                      
                      if (isSelected) {
                        seatStatusClass += ' seat-selected';
                      }

                      return (
                        <motion.div
                          key={seat.id}
                          className={`seat-3d ${seatStatusClass}`}
                          initial={{ opacity: 0, z: -50 }}
                          animate={{ opacity: 1, z: 0 }}
                          transition={{ delay: i * 0.01 }}
                          tabIndex={selectionModeBlockId === block.id ? 0 : -1}
                          onKeyDown={(e) => {
                            if (selectionModeBlockId !== block.id) return;
                            const currentEl = document.getElementById(`seat-${seat.id}`);
                            if (!currentEl) return;
                            const rect = currentEl.getBoundingClientRect();
                            
                            let nextIndex = i;
                            
                            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                              nextIndex = e.key === 'ArrowRight' ? i + 1 : i - 1;
                            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                              let bestDist = Infinity;
                              const isDown = e.key === 'ArrowDown';
                              
                              seats.forEach((s, idx) => {
                                if (idx === i) return;
                                const targetEl = document.getElementById(`seat-${s.id}`);
                                if (!targetEl) return;
                                const targetRect = targetEl.getBoundingClientRect();
                                
                                // Must be roughly in the same column (within 20px left offset)
                                if (Math.abs(targetRect.left - rect.left) < 20) {
                                  if (isDown && targetRect.top > rect.top) {
                                    if (targetRect.top - rect.top < bestDist) {
                                      bestDist = targetRect.top - rect.top;
                                      nextIndex = idx;
                                    }
                                  } else if (!isDown && targetRect.top < rect.top) {
                                    if (rect.top - targetRect.top < bestDist) {
                                      bestDist = rect.top - targetRect.top;
                                      nextIndex = idx;
                                    }
                                  }
                                }
                              });
                            }
                            
                            if (nextIndex >= 0 && nextIndex < seats.length && nextIndex !== i) {
                              e.preventDefault();
                              const nextSeat = seats[nextIndex];
                              const nextEl = document.getElementById(`seat-${nextSeat.id}`);
                              if (nextEl) nextEl.focus();
                              if (e.shiftKey) {
                                handleToggleSeatSelection(nextSeat.id);
                              }
                            } else if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleSeatClick(e, { ...seat, blockId: block.id }, seats);
                            }
                          }}
                          onClick={(e) => {
                            if (selectionModeBlockId === block.id) {
                              handleSeatClick(e, { ...seat, blockId: block.id }, seats);
                            } else if (isOccupied) {
                              onSelectStudent(occupant);
                            } else if (!seat.isMaintenance && !seat.isUnavailable) {
                              setSelectedDesk(seat.name);
                            }
                          }}
                          title={isOccupied ? `Occupied by: ${occupant.name} (${occupant.id})` : `Desk ${seat.name} is ${seat.isMaintenance ? 'Under Maintenance' : 'Available'}`}
                          id={`seat-${seat.id}`}
                        >
                          <div style={{ fontSize: '14px', fontWeight: 700 }}>{seat.name}</div>
                          <div style={{ fontSize: '10px', marginTop: '4px', fontWeight: 500, letterSpacing: '0.05em' }}>
                            {isOccupied ? occupant.name.split(' ')[0].toUpperCase() : seat.isMaintenance ? 'MAINT' : seat.isUnavailable ? 'N/A' : 'EMPTY'}
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </div>
                
                {/* Render Non-Fixed Students as a list below the grid */}
                {nonFixedStudents.length > 0 && (
                  <div style={{ marginTop: '16px', padding: '16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <h4 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '12px' }}>Non-Fixed Students Currently Active ({selectedShift})</h4>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      {nonFixedStudents.map(student => (
                        <div key={student.id} onClick={() => onSelectStudent(student)} style={{ padding: '8px 12px', background: 'white', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <UserCheck size={14} color="var(--brand-primary)" />
                          <span style={{ fontWeight: 500 }}>{student.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {/* Desk Action Modal for Empty Seat */}
      <AnimatePresence>
        {selectedDesk && (
          <motion.div 
            className="modal-overlay" 
            onClick={() => setSelectedDesk(null)}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <motion.div 
              className="modal-content" style={{ maxWidth: '400px' }} onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }}
            >
              <div className="modal-header">
                <h3 style={{ fontSize: '18px', fontWeight: 600 }}>Allocate Desk {selectedDesk}</h3>
                <button className="btn-ghost" style={{ border: 'none', cursor: 'pointer', background: 'transparent' }} onClick={() => setSelectedDesk(null)}>
                  <X size={20} />
                </button>
              </div>

              <div className="modal-body" style={{ textAlign: 'center' }}>
                <div style={{ 
                  fontSize: '32px', margin: '0 auto 24px', width: '80px', height: '80px', 
                  borderRadius: '50%', background: '#f0fdf4', color: '#16a34a', 
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800,
                  boxShadow: '0 4px 12px rgba(22, 163, 74, 0.2)'
                }}>
                  {selectedDesk}
                </div>
                <h4 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>Desk {selectedDesk} is Vacant</h4>
                <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px' }}>
                  Register a new student directly into this desk assignment.
                </p>
                <button className="btn btn-primary" style={{ width: '100%', padding: '12px' }} onClick={() => { setSelectedDesk(null); onOpenNewStudent(); }}>
                  Register Student on Desk {selectedDesk}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bulk Add Modal */}
      <AnimatePresence>
        {showBulkAddModal && (() => {
          const block = branches.flatMap(b => b.blocks).find(blk => blk.id === showBulkAddModal);
          const branch = branches.find(b => b.blocks.some(blk => blk.id === showBulkAddModal));
          return (
            <BulkAddModal 
              branch={branch}
              block={block}
              seatTypes={seatTypes}
              onClose={() => setShowBulkAddModal(null)}
              onAdd={(prefix, start, end, typeId) => {
                let addedCount = 0;
                let duplicateNames = [];
                updateSeatsInBlock(branch.id, block.id, (seats) => {
                  const newSeats = [...seats];
                  for (let i = start; i <= end; i++) {
                    const seatName = `${prefix}${i}`;
                    if (newSeats.some(s => s.name === seatName)) {
                      duplicateNames.push(seatName);
                    } else {
                      newSeats.push({
                        id: `seat-${Date.now()}-${i}`,
                        name: seatName,
                        typeId: typeId,
                        isMaintenance: false,
                        isUnavailable: false
                      });
                      addedCount++;
                    }
                  }
                  return newSeats;
                });
                
                if (addedCount > 0) toast.success(`Added ${addedCount} new seats.`);
                if (duplicateNames.length > 0) toast.error(`Skipped ${duplicateNames.length} duplicate seats: ${duplicateNames.join(', ')}`);
                setShowBulkAddModal(null);
              }}
            />
          );
        })()}
      </AnimatePresence>

      {/* Bulk Remove Result Modal */}
      <AnimatePresence>
        {bulkRemoveResult && (
          <motion.div className="modal-overlay" onClick={() => setBulkRemoveResult(null)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="modal-content" style={{ maxWidth: '600px' }} onClick={(e) => e.stopPropagation()} initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }}>
              <div className="modal-header">
                <h3 style={{ fontSize: '18px', fontWeight: 600 }}>Bulk Remove Results</h3>
                <button style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }} onClick={() => setBulkRemoveResult(null)}><X size={20}/></button>
              </div>
              <div className="modal-body">
                {bulkRemoveResult.removedCount > 0 && (
                  <div style={{ padding: '16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', marginBottom: '16px' }}>
                    <p style={{ color: '#16a34a', fontWeight: 600, margin: 0 }}>Successfully removed {bulkRemoveResult.removedCount} available seats.</p>
                  </div>
                )}
                {bulkRemoveResult.skippedSeats.length > 0 && (
                  <div>
                    <h4 style={{ color: '#ef4444', fontSize: '15px', fontWeight: 600, marginBottom: '8px' }}>Blocked! {bulkRemoveResult.skippedSeats.length} Seats are Occupied:</h4>
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>You must transfer the student to another eligible available seat before you can remove their current seat. Never automatically move or delete the student.</p>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '400px', overflowY: 'auto' }}>
                      {bulkRemoveResult.skippedSeats.map(item => (
                        <li key={item.seat.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fee2e2', padding: '12px 16px', borderRadius: '8px', border: '1px solid #fecaca' }}>
                          <div>
                            <strong style={{ color: '#991b1b' }}>{item.seat.name}</strong>
                            <div style={{ fontSize: '13px', color: '#b91c1c', marginTop: '2px' }}>Occupied by {item.occupant.name}</div>
                          </div>
                          <button className="btn btn-primary" style={{ padding: '8px 16px' }} onClick={() => { setBulkRemoveResult(null); onRelocateStudent(item.occupant); }}>
                            Transfer Student
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setBulkRemoveResult(null)}>Close</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

const BulkAddModal = ({ branch, block, seatTypes, onClose, onAdd }) => {
  const [prefix, setPrefix] = useState('S');
  const [startNum, setStartNum] = useState(1);
  const [endNum, setEndNum] = useState(20);
  const [selectedTypeId, setSelectedTypeId] = useState(seatTypes[0]?.id || '');

  return (
    <motion.div className="modal-overlay" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
        <div className="modal-header">
          <h3 style={{ fontSize: '18px', fontWeight: 600 }}>Bulk Add Seats</h3>
          <button className="btn-ghost" onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
        </div>
        <div className="modal-body">
          <p style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>Adding seats to <strong>{branch.name} - {block.name}</strong></p>
          <div className="form-group">
            <label className="form-label">Seat Prefix</label>
            <input className="form-input" value={prefix} onChange={e => setPrefix(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label className="form-label">Start Number</label>
              <NumericInput className="form-input" value={startNum} onChange={e => setStartNum(Number(e.target.value))} />
            </div>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label className="form-label">End Number</label>
              <NumericInput className="form-input" value={endNum} onChange={e => setEndNum(Number(e.target.value))} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Seat Type</label>
            <select className="form-select" value={selectedTypeId} onChange={e => setSelectedTypeId(e.target.value)}>
              {seatTypes.map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={() => onAdd(prefix, startNum, endNum, selectedTypeId)}>Add Seats</button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
