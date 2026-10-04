const fs = require('fs');
const path = require('path');

const newSeatMapContent = `import React, { useState, useEffect } from 'react';
import { useLibrary } from '../context/LibraryContext';
import { Grid, Clock, CheckCircle2, UserCheck, ShieldAlert, X, MoreVertical, Plus, Trash2, Settings, Ban } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshButton } from './RefreshButton';
import { NumericInput } from './NumericInput';
import toast from 'react-hot-toast';

export const SeatMap = ({ onSelectStudent, onOpenNewStudent, onRelocateStudent }) => {
  const { settings, students, branches, sections, seats, activeBranchId, seatTypes, setSeats, shifts, getBlockOccupancyMap, getCurrentActiveAdmissions } = useLibrary();

  const libId = settings.libraryId;
  const [selectedShiftId, setSelectedShiftId] = useState(shifts[0]?.id || 'sh1');
  const [selectedDesk, setSelectedDesk] = useState(null);
  
  // Selection State for Bulk Actions
  const [selectionModeSectionId, setSelectionModeSectionId] = useState(null);
  const [selectedSeatIds, setSelectedSeatIds] = useState([]);
  const [showBulkMenuForSection, setShowBulkMenuForSection] = useState(null);

  const branchesToRender = activeBranchId === 'all' ? branches : branches.filter(b => b.id === activeBranchId);
  const contexts = branchesToRender.length > 0 ? branchesToRender : [{ id: undefined, name: 'Library Level' }];

  // -- Bulk Action Helpers --
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

  const updateSeats = (modifierFunc) => {
    setSeats(prev => modifierFunc([...prev]));
  };

  const handleMarkStatus = (statusObj) => {
    if (selectedSeatIds.length === 0) return toast.error('No seats selected.');
    updateSeats((allSeats) => {
      return allSeats.map(s => selectedSeatIds.includes(s.id) ? { ...s, ...statusObj } : s);
    });
    toast.success('Seats updated successfully.');
    setSelectedSeatIds([]);
    setSelectionModeSectionId(null);
  };

  const handleBulkRemove = (seatOccupancyMap) => {
    if (selectedSeatIds.length === 0) return toast.error('No seats selected.');
    
    let removedCount = 0;
    updateSeats((allSeats) => {
      const newSeats = [];
      allSeats.forEach(seat => {
         if (selectedSeatIds.includes(seat.id)) {
            const occupant = seatOccupancyMap[seat.name];
            if (occupant) {
               newSeats.push(seat); // Skip occupied seats
               toast.error(\`Skipped seat \${seat.name} because it is currently occupied.\`);
            } else {
               removedCount++;
            }
         } else {
            newSeats.push(seat);
         }
      });
      return newSeats;
    });

    if (removedCount > 0) toast.success(\`Removed \${removedCount} unoccupied seats.\`);
    setSelectedSeatIds([]);
    setSelectionModeSectionId(null);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setSelectedDesk(null);
        setShowBulkMenuForSection(null);
        if (selectionModeSectionId) {
          setSelectionModeSectionId(null);
          setSelectedSeatIds([]);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedDesk, selectionModeSectionId]);

  return (
    <motion.div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {/* Header Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Interactive Desk Map</h2>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Real-time occupancy</p>
        </div>

        {/* Shift Filter Tabs */}
        <div style={{ display: 'flex', gap: '8px', background: 'var(--bg-surface)', padding: '6px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-light)', boxShadow: 'var(--shadow-sm)' }}>
          {shifts.map(shift => (
            <button
              key={shift.id}
              onClick={() => setSelectedShiftId(shift.id)}
              style={{
                position: 'relative', padding: '8px 16px', borderRadius: '6px', border: 'none', background: 'transparent',
                color: selectedShiftId === shift.id ? 'white' : 'var(--text-secondary)',
                fontWeight: 500, fontSize: '13px', cursor: 'pointer', outline: 'none'
              }}
            >
              {selectedShiftId === shift.id && (
                <motion.div layoutId="shiftIndicator" style={{ position: 'absolute', inset: 0, background: 'var(--brand-primary)', borderRadius: '6px', zIndex: -1 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }} />
              )}
              {shift.name}
            </button>
          ))}
        </div>
        <RefreshButton />
      </div>

      {/* Interactive 3D Seat Map Grids */}
      {contexts.map(branch => {
         const branchSections = sections.filter(s => s.branchId === branch.id);
         const renderSections = branchSections.length > 0 ? branchSections : [{ id: undefined, name: 'Main Section' }];

         return (
          <div key={branch.id || 'lib'}>
            {renderSections.map(section => {
              const sectionSeats = seats.filter(s => s.sectionId === section.id && s.branchId === branch.id);
              const sectionSeatTypes = seatTypes.filter(st => st.sectionId === section.id && st.branchId === branch.id);
              const nonFixedTypes = sectionSeatTypes.filter(st => st.allocationMode === 'Non-Fixed');

              // Get occupant map for fixed seats
              const blockOccupancy = getBlockOccupancyMap(branch.id, section.id, selectedShiftId);
              const seatOccupancyMap = blockOccupancy.fixed;
              
              const occupiedCount = Object.keys(seatOccupancyMap).length;
              const availableCount = Math.max(0, sectionSeats.length - occupiedCount);
              
              // Non-fixed stats
              const nonFixedStats = nonFixedTypes.map(st => {
                 const activeStudents = getCurrentActiveAdmissions(libId, branch.id, section.id, st.id, selectedShiftId);
                 return { name: st.name, count: activeStudents.length, max: st.maximumStudentsAllowed };
              });

              if (sectionSeats.length === 0 && nonFixedStats.length === 0) return null;

              return (
                <div key={section.id || 'main'} className="premium-card" style={{ display: 'flex', flexDirection: 'column', gap: '24px', marginBottom: '16px', padding: '24px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                    <div>
                      <h3 style={{ fontSize: '18px', fontWeight: 600 }}>{branch.name} - {section.name}</h3>
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
                        {nonFixedStats.map(ns => (
                          <div key={ns.name} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#f0f9ff', border: '1px solid #bae6fd', padding: '2px 8px', borderRadius: '12px' }}>
                            <span style={{ fontSize: '12px', fontWeight: 600, color: '#0369a1' }}>{ns.name} Capacity: {ns.count} {ns.max ? \`/ \${ns.max}\` : '(Unlimited)'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    <div style={{ position: 'relative' }}>
                      <button className="btn btn-ghost" style={{ padding: '8px', fontWeight: 'bold' }} onClick={() => setShowBulkMenuForSection(showBulkMenuForSection === section.id ? null : section.id)}>
                        <MoreVertical size={24} strokeWidth={3} color="var(--text-primary)" />
                      </button>

                      {showBulkMenuForSection === section.id && (
                        <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: '8px', background: 'white', borderRadius: '8px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', border: '1px solid #e2e8f0', zIndex: 50, minWidth: '220px', overflow: 'hidden' }}>
                          <button className="dropdown-item" onClick={() => { setSelectionModeSectionId(section.id); setShowBulkMenuForSection(null); }}>
                            <CheckCircle2 size={16} /> Select Seats
                          </button>
                          <button className="dropdown-item" onClick={() => { setSelectionModeSectionId(section.id); handleSelectAll(sectionSeats); setShowBulkMenuForSection(null); }}>
                            <CheckCircle2 size={16} /> Select All
                          </button>
                          <div style={{ padding: '8px 16px', background: '#f8fafc', fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.05em', borderTop: '1px solid var(--border-light)', borderBottom: '1px solid var(--border-light)' }}>
                            BULK ACTIONS
                          </div>
                          <button className="dropdown-item" style={{ color: '#ef4444' }} onClick={() => handleBulkRemove(seatOccupancyMap)}>
                            <Trash2 size={16} /> Remove Unoccupied Seats
                          </button>
                          <button className="dropdown-item" onClick={() => handleMarkStatus({ isMaintenance: true, isUnavailable: false })}>
                            <Settings size={16} /> Mark Maintenance
                          </button>
                          <button className="dropdown-item" onClick={() => handleMarkStatus({ isMaintenance: false, isUnavailable: false })}>
                            <CheckCircle2 size={16} /> Mark Available
                          </button>
                          <button className="dropdown-item" onClick={() => handleMarkStatus({ isUnavailable: true, isMaintenance: false })}>
                            <Ban size={16} /> Mark Unavailable
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {selectionModeSectionId === section.id && (
                    <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '8px 16px', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 600, color: '#16a34a' }}>{selectedSeatIds.length} Seats Selected</span>
                      <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: '13px' }} onClick={() => { setSelectionModeSectionId(null); setSelectedSeatIds([]); }}>Cancel Selection</button>
                    </div>
                  )}

                  <div className="seat-map-container">
                    <div className="seat-grid-3d">
                      {sectionSeats.map((seat, i) => {
                        const occupant = seatOccupancyMap[seat.name];
                        const isOccupied = Boolean(occupant);
                        const isSelected = selectedSeatIds.includes(seat.id);
                        
                        let seatStatusClass = 'seat-available';
                        if (seat.isUnavailable) seatStatusClass = 'seat-unavailable';
                        else if (seat.isMaintenance) seatStatusClass = 'seat-maintenance';
                        else if (isOccupied) {
                          if (occupant.status === 'Expired') seatStatusClass = 'seat-expired';
                          else if (occupant.status === 'Expiring Soon') seatStatusClass = 'seat-expiring';
                          else seatStatusClass = occupant.gender === 'Female' ? 'seat-occupied-female' : 'seat-occupied-male';
                        }
                        
                        if (isSelected) seatStatusClass += ' seat-selected';

                        return (
                          <motion.div key={seat.id} className={\`seat-3d \${seatStatusClass}\`}
                            initial={{ opacity: 0, z: -50 }} animate={{ opacity: 1, z: 0 }} transition={{ delay: i * 0.01 }}
                            onClick={() => {
                              if (selectionModeSectionId === section.id) {
                                handleToggleSeatSelection(seat.id);
                              } else {
                                setSelectedDesk({ seat, occupant });
                              }
                            }}
                          >
                            <div className="seat-surface">
                              <span className="seat-number">{seat.name}</span>
                              {isOccupied && <span className="seat-occupant-name">{occupant.name.split(' ')[0]}</span>}
                            </div>
                            <div className="seat-front"></div>
                            <div className="seat-right"></div>
                            <div className="seat-shadow"></div>
                            {isSelected && (
                              <div style={{ position: 'absolute', top: '-8px', right: '-8px', background: '#16a34a', color: '#fff', borderRadius: '50%', padding: '2px', zIndex: 10 }}>
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

      {/* Desk Details Modal */}
      <AnimatePresence>
        {selectedDesk && (
          <motion.div className="modal-overlay" onClick={() => setSelectedDesk(null)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="modal-content" onClick={e => e.stopPropagation()} initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }}>
              <div className="modal-header">
                <h3 style={{ fontSize: '18px', fontWeight: 600 }}>Desk {selectedDesk.seat.name} Details</h3>
                <button className="btn-ghost" onClick={() => setSelectedDesk(null)}><X size={20} /></button>
              </div>
              <div className="modal-body">
                {selectedDesk.occupant ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--brand-primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: 700 }}>
                        {selectedDesk.occupant.name.charAt(0)}
                      </div>
                      <div>
                        <h4 style={{ fontSize: '18px', fontWeight: 600 }}>{selectedDesk.occupant.name}</h4>
                        <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>ID: {selectedDesk.occupant.id} • {selectedDesk.occupant.phone}</div>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', background: 'var(--bg-main)', padding: '16px', borderRadius: '8px' }}>
                       <div>
                         <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 600, letterSpacing: '0.05em' }}>EXPIRY DATE</span>
                         <div style={{ fontSize: '16px', fontWeight: 600, color: '#10b981', marginTop: '4px' }}>{selectedDesk.occupant.expiryDate}</div>
                       </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-secondary)' }}>
                     <CheckCircle2 size={48} color="#10b981" style={{ margin: '0 auto 16px' }} />
                     <h4 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>Desk is Available</h4>
                     <p>This desk is currently unoccupied for the selected shift.</p>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
`;

fs.writeFileSync(path.join(__dirname, 'src/components/SeatMap.jsx'), newSeatMapContent, 'utf8');
console.log('SeatMap.jsx overwritten successfully.');
