import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Save } from 'lucide-react';
import { useLibrary } from '../../context/LibraryContext';
import toast from 'react-hot-toast';

export const EditStudentModal = ({ isOpen, onClose, student, onSaveComplete }) => {
  const { updateStudentDetails, settings } = useLibrary();
  
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    emergencyPhone: '',
    gender: 'Male',
    dob: '',
    email: '',
    address: '',
    idProofNumber: '',
    idProofStatus: 'Pending',
    bloodGroup: ''
  });

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
      setFormData({
        name: student.name || '',
        phone: student.phone || '',
        emergencyPhone: student.emergencyPhone || '',
        gender: student.gender || 'Male',
        dob: student.dob || '',
        email: student.email || '',
        address: student.address || '',
        idProofNumber: student.idProofNumber || '',
        idProofStatus: student.idProofStatus || 'Pending',
        bloodGroup: student.bloodGroup || ''
      });
    }
  }, [isOpen, student]);

  if (!isOpen || !student) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.name.trim()) return toast.error('Name is required');
    if (!formData.phone.trim() || formData.phone.length !== 10) return toast.error('Valid 10-digit student mobile number is required');
    if (formData.emergencyPhone && formData.emergencyPhone.trim() && formData.emergencyPhone.trim().length !== 10) {
      return toast.error('Emergency contact number must be 10 digits if provided');
    }

    const result = updateStudentDetails(student.id, {
      name: formData.name.trim(),
      phone: formData.phone.trim(),
      emergencyPhone: formData.emergencyPhone ? formData.emergencyPhone.trim() : '',
      gender: formData.gender,
      dob: formData.dob,
      email: formData.email.trim(),
      address: formData.address.trim(),
      idProofNumber: formData.idProofNumber.trim(),
      idProofStatus: formData.idProofStatus,
      bloodGroup: formData.bloodGroup
    });

    if (result.error) {
      toast.error(result.message);
    } else {
      toast.success('Student details updated successfully!');
      if (onSaveComplete) onSaveComplete(result.student);
      onClose();
    }
  };

  return (
    <div className="modal-overlay">
      <motion.div 
        className="modal-content"
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        style={{ maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div className="modal-header">
          <h3 style={{ fontSize: '18px', fontWeight: 600 }}>Edit Student Details</h3>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }} onClick={onClose}>
            <X size={24} />
          </button>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label">Full Name *</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={formData.name} 
                  onChange={(e) => setFormData({...formData, name: e.target.value})} 
                  required 
                />
              </div>
              <div className="form-group">
                <label className="form-label">Student Mobile Number *</label>
                <input 
                  type="tel" 
                  maxLength={10} 
                  className="form-input" 
                  value={formData.phone} 
                  onChange={(e) => setFormData({...formData, phone: e.target.value})} 
                  required 
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label">Emergency Contact Number</label>
                <input 
                  type="tel" 
                  maxLength={10} 
                  className="form-input" 
                  value={formData.emergencyPhone} 
                  onChange={(e) => setFormData({...formData, emergencyPhone: e.target.value})} 
                  placeholder="Optional 10-digit number"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Gender</label>
                <select 
                  className="form-select" 
                  value={formData.gender} 
                  onChange={(e) => setFormData({...formData, gender: e.target.value})}
                >
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label">Date of Birth</label>
                <input 
                  type="date" 
                  className="form-input" 
                  value={formData.dob} 
                  onChange={(e) => setFormData({...formData, dob: e.target.value})} 
                />
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input 
                  type="email" 
                  className="form-input" 
                  value={formData.email} 
                  onChange={(e) => setFormData({...formData, email: e.target.value})} 
                />
              </div>
            </div>
            
            <div className="form-group">
              <label className="form-label">Address</label>
              <textarea 
                className="form-input" 
                rows={2} 
                value={formData.address} 
                onChange={(e) => setFormData({...formData, address: e.target.value})} 
                style={{ resize: 'vertical' }}
              />
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label">ID Proof Number</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={formData.idProofNumber} 
                  onChange={(e) => setFormData({...formData, idProofNumber: e.target.value})} 
                />
              </div>
              <div className="form-group">
                <label className="form-label">ID Proof Status</label>
                <select 
                  className="form-select" 
                  value={formData.idProofStatus} 
                  onChange={(e) => setFormData({...formData, idProofStatus: e.target.value})}
                >
                  <option value="Pending">Pending</option>
                  <option value="Verified">Verified</option>
                  <option value="Not Required">Not Required</option>
                </select>
              </div>
            </div>
            
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary"><Save size={16} /> Save Changes</button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};
