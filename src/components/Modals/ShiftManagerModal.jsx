import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Plus, Trash2, Edit2, Save, Clock, Calendar } from 'lucide-react';
import { useLibrary } from '../../context/LibraryContext';
import toast from 'react-hot-toast';

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const ShiftManagerModal = ({ isOpen, onClose }) => {
  const { shifts, addShift, deleteShift, updateShift, activeBranchId, branches, canDeleteShift } = useLibrary();
  
  const [newShiftName, setNewShiftName] = useState('');
  const [newStartTime, setNewStartTime] = useState('06:00');
  const [newEndTime, setNewEndTime] = useState('12:00');
  const [newDays, setNewDays] = useState(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  const [editingShiftId, setEditingShiftId] = useState(null);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const toggleDay = (day) => {
    if (newDays.includes(day)) {
      if (newDays.length === 1) return toast.error('Shift must include at least one day.');
      setNewDays(newDays.filter(d => d !== day));
    } else {
      setNewDays([...newDays, day]);
    }
  };

  const handleAddShift = (e) => {
    e.preventDefault();
    const trimmed = newShiftName.trim();
    if (!trimmed) {
      toast.error('Shift name cannot be empty.');
      return;
    }

    if (!newStartTime || !newEndTime) {
      toast.error('Start time and end time are required.');
      return;
    }

    const branchShifts = shifts.filter(sh => activeBranchId === 'all' || sh.branchId === activeBranchId);
    if (branchShifts.some(s => s.name.toLowerCase() === trimmed.toLowerCase() && s.id !== editingShiftId)) {
      toast.error('A shift with this name already exists.');
      return;
    }

    if (editingShiftId) {
      updateShift(editingShiftId, {
        name: trimmed,
        startTime: newStartTime,
        endTime: newEndTime,
        daysOfWeek: newDays
      });
      setEditingShiftId(null);
      toast.success('Shift updated successfully.');
    } else {
      const targetBranchId = activeBranchId === 'all' ? (branches[0]?.id || 'all') : activeBranchId;
      addShift({
        name: trimmed,
        startTime: newStartTime,
        endTime: newEndTime,
        daysOfWeek: newDays,
        branchId: targetBranchId
      });
      toast.success('Shift created successfully.');
    }

    setNewShiftName('');
    setNewStartTime('06:00');
    setNewEndTime('12:00');
    setNewDays(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  };

  const handleDeleteShift = (shift) => {
    const check = canDeleteShift(shift.id);
    if (!check.allowed) {
      toast.error(check.reason);
      return;
    }

    if (window.confirm(`Are you sure you want to delete the shift "${shift.name}"?`)) {
      deleteShift(shift.id);
      toast.success('Shift deleted successfully.');
    }
  };

  const handleEditClick = (shift) => {
    setEditingShiftId(shift.id);
    setNewShiftName(shift.name);
    setNewStartTime(shift.startTime || '06:00');
    setNewEndTime(shift.endTime || '12:00');
    setNewDays(shift.daysOfWeek && shift.daysOfWeek.length > 0 ? shift.daysOfWeek : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  };

  return (
    <div className="modal-overlay">
      <motion.div 
        className="modal-content"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        style={{ maxWidth: '520px' }}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Clock size={20} color="var(--brand-primary)" />
            <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>Manage Study Shifts</h3>
          </div>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }} onClick={onClose} title="Close">
            <X size={24} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          <form onSubmit={handleAddShift} style={{ background: '#f8fafc', border: '1px solid var(--border-light)', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              {editingShiftId ? 'Edit Shift' : 'Add Custom Shift'}
            </h4>
            
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ fontSize: '12px' }}>Shift Name *</label>
              <input 
                type="text" 
                className="form-input" 
                placeholder="e.g. Early Morning, Evening"
                value={newShiftName}
                onChange={(e) => setNewShiftName(e.target.value)}
                required
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: '12px' }}>Start Time</label>
                <input 
                  type="time" 
                  className="form-input" 
                  value={newStartTime} 
                  onChange={e => setNewStartTime(e.target.value)} 
                  required 
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: '12px' }}>End Time</label>
                <input 
                  type="time" 
                  className="form-input" 
                  value={newEndTime} 
                  onChange={e => setNewEndTime(e.target.value)} 
                  required 
                />
              </div>
            </div>

            <div>
              <label className="form-label" style={{ fontSize: '12px', marginBottom: '6px' }}>Days of Week</label>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {ALL_DAYS.map(day => {
                  const isSelected = newDays.includes(day);
                  return (
                    <button
                      type="button"
                      key={day}
                      onClick={() => toggleDay(day)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        border: isSelected ? '1px solid var(--brand-primary)' : '1px solid var(--border-light)',
                        background: isSelected ? 'var(--brand-primary)' : '#fff',
                        color: isSelected ? '#fff' : 'var(--text-secondary)'
                      }}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </div>
            
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                {editingShiftId ? <><Save size={14} /> Save Shift</> : <><Plus size={14} /> Add Shift</>}
              </button>
              {editingShiftId && (
                <button type="button" className="btn btn-ghost" onClick={() => {
                  setEditingShiftId(null);
                  setNewShiftName('');
                  setNewStartTime('06:00');
                  setNewEndTime('12:00');
                  setNewDays(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
                }}>
                  Cancel
                </button>
              )}
            </div>
          </form>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '260px', overflowY: 'auto' }}>
            <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Configured Shifts</h4>
            
            {shifts.filter(sh => activeBranchId === 'all' || sh.branchId === activeBranchId || sh.branchId === 'all').map(shift => {
              return (
                <div key={shift.id} style={{ 
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
                  padding: '10px 14px', background: '#fff', borderRadius: '8px',
                  border: '1px solid var(--border-light)'
                }}>
                  <div>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {shift.name}
                    </span>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      {shift.startTime && shift.endTime ? `${shift.startTime} – ${shift.endTime}` : ''} 
                      {shift.daysOfWeek?.length > 0 ? ` • ${shift.daysOfWeek.join(', ')}` : ''}
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button 
                      className="btn btn-ghost"
                      style={{ padding: '6px', color: 'var(--brand-primary)', cursor: 'pointer' }}
                      onClick={() => handleEditClick(shift)}
                      title="Edit Shift"
                    >
                      <Edit2 size={15} />
                    </button>
                    <button 
                      className="btn btn-ghost"
                      style={{ padding: '6px', color: '#ef4444', cursor: 'pointer' }}
                      onClick={() => handleDeleteShift(shift)}
                      title="Delete Shift"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
            
            {shifts.length === 0 && (
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', textAlign: 'center', padding: '20px 0' }}>No shifts configured yet.</p>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};
