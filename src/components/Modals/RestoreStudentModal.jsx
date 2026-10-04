import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, RotateCcw } from 'lucide-react';
import { useLibrary } from '../../context/LibraryContext';
import toast from 'react-hot-toast';

export const RestoreStudentModal = ({ isOpen, onClose, student, onRestoreComplete }) => {
  const { students, restoreStudent } = useLibrary();
  const [newSeatNo, setNewSeatNo] = useState('');
  const [seatConflict, setSeatConflict] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen && student) {
      // Check if previous seat is occupied
      const isOccupied = students.some(s => s.seatNo === student.seatNo && s.branchId === student.branchId);
      setSeatConflict(isOccupied);
      setNewSeatNo('');
    }
  }, [isOpen, student, students]);

  if (!isOpen || !student) return null;

  const handleRestore = (e) => {
    e.preventDefault();
    if (seatConflict && !newSeatNo) {
      toast.error('Please assign a new seat as the previous one is occupied.');
      return;
    }

    restoreStudent(student.id, seatConflict ? newSeatNo : null);
    toast.success(`${student.name} has been restored successfully.`);
    onRestoreComplete();
  };

  return (
    <div className="modal-overlay">
      <motion.div 
        className="modal-content"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        style={{ maxWidth: '400px' }}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <RotateCcw size={20} color="var(--brand-primary)" />
            <h3 style={{ fontSize: '18px', fontWeight: 600 }}>Restore Student</h3>
          </div>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }} onClick={onClose} title="Close">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleRestore}>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
              You are about to restore <strong>{student.name}</strong> to the active students list.
            </p>

            {seatConflict ? (
              <div style={{ background: '#fef2f2', border: '1px solid #fee2e2', padding: '12px', borderRadius: '8px' }}>
                <p style={{ fontSize: '13px', color: '#b91c1c', marginBottom: '8px', fontWeight: 500 }}>
                  Their previous desk ({student.seatNo}) is currently occupied by another active student. Please assign a new desk.
                </p>
                <div className="form-group">
                  <label className="form-label" style={{ color: '#991b1b' }}>New Desk Number *</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="e.g. A-15"
                    value={newSeatNo}
                    onChange={(e) => setNewSeatNo(e.target.value.toUpperCase())}
                    required
                  />
                </div>
              </div>
            ) : (
              <div style={{ background: '#f0fdf4', border: '1px solid #dcfce7', padding: '12px', borderRadius: '8px' }}>
                <p style={{ fontSize: '13px', color: '#15803d', fontWeight: 500 }}>
                  Their previous desk ({student.seatNo}) is available and will be automatically reassigned.
                </p>
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Restore Student</button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};
