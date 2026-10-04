import React, { useState } from 'react';
import { useLibrary } from '../context/LibraryContext';
import { Settings, ShieldCheck, Building2, Download, Upload, RefreshCw, Save, Plus } from 'lucide-react';
import { motion } from 'framer-motion';
import { RefreshButton } from './RefreshButton';
import { NumericInput } from './NumericInput';

export const LibrarySettings = () => {
  const { 
    settings, setSettings, branches, setBranches, staffMembers, setStaffMembers, 
    plans, setPlans, shifts, seatTypes, currentStaff, activeBranchId,
    exportDataJSON, importDataJSON, resetToDemoData, students
  } = useLibrary();

  const [formSettings, setFormSettings] = useState(settings);

  // Plans Management State
  const [editingPlanId, setEditingPlanId] = useState(null);
  const [newPlanName, setNewPlanName] = useState('');
  const [newPlanPrice, setNewPlanPrice] = useState('');
  const [newPlanDuration, setNewPlanDuration] = useState(1);
  const [newPlanShiftIds, setNewPlanShiftIds] = useState(shifts?.[0]?.id ? [shifts[0].id] : []);
  const [newPlanSeatTypeId, setNewPlanSeatTypeId] = useState(seatTypes?.[0]?.id || '');
  const [newPlanBlockId, setNewPlanBlockId] = useState('');
  
  const handleEditPlan = (p) => {
    setEditingPlanId(p.id);
    setNewPlanName(p.name);
    setNewPlanPrice(p.price);
    setNewPlanDuration(p.durationMonths || 1);
    setNewPlanShiftIds(p.shiftIds || (p.shiftId ? [p.shiftId] : []));
    setNewPlanSeatTypeId(p.seatTypeId);
    setNewPlanBlockId(p.blockIds?.[0] || 'all');
  };

  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchCode, setNewBranchCode] = useState('');
  const [newBranchAddress, setNewBranchAddress] = useState('');
  const [newBranchSeats, setNewBranchSeats] = useState(40);

  const handleSaveBranding = (e) => {
    e.preventDefault();
    setSettings(formSettings);
  };

  const handleAddBranch = (e) => {
    e.preventDefault();
    if (!newBranchName || !newBranchCode) return;
    const newBId = `b-${Date.now()}`;
    const newB = { 
      id: newBId, 
      code: newBranchCode.toUpperCase(), 
      name: newBranchName, 
      address: newBranchAddress, 
      active: true,
      blocks: [
        { id: `blk-${newBId}-main`, name: "Main Block", totalSeats: Number(newBranchSeats), nonFixedSeatEnabled: false, active: true }
      ]
    };
    setBranches(prev => [...prev, newB]);
    setNewBranchName(''); setNewBranchCode(''); setNewBranchAddress(''); setNewBranchSeats(40);
  };

  const handleToggleStaffPermission = (staffId, permKey) => {
    setStaffMembers(prev => prev.map(st => st.id === staffId ? { ...st, permissions: { ...st.permissions, [permKey]: !st.permissions[permKey] } } : st));
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        if (importDataJSON(JSON.parse(event.target.result))) alert('Database restored successfully from JSON backup!');
        else alert('Invalid backup file format.');
      } catch (err) { alert('Error parsing JSON backup file.'); }
    };
    reader.readAsText(file);
  };

  const handleAddPlan = (e) => {
    e.preventDefault();
    if (!newPlanName || !newPlanPrice) return;
    
    if (editingPlanId) {
      setPlans(prev => prev.map(p => p.id === editingPlanId ? {
        ...p,
        name: newPlanName,
        price: Number(newPlanPrice),
        durationMonths: Number(newPlanDuration),
        shiftIds: newPlanShiftIds,
        shiftId: undefined, // ensure legacy is removed
        seatTypeId: newPlanSeatTypeId,
        blockIds: [newPlanBlockId]
      } : p));
      setEditingPlanId(null);
    } else {
      const newPlan = {
        id: `pl-${Date.now()}`,
        name: newPlanName,
        price: Number(newPlanPrice),
        durationMonths: Number(newPlanDuration),
        shiftIds: newPlanShiftIds,
        seatTypeId: newPlanSeatTypeId,
        blockIds: [newPlanBlockId],
        branchId: activeBranchId === 'all' ? branches[0].id : activeBranchId,
        defaultForBlockId: null,
        active: true
      };
      setPlans(prev => [...prev, newPlan]);
    }
    
    setNewPlanName('');
    setNewPlanPrice('');
    setNewPlanDuration(1);
  };

  const handleDeletePlan = (planId) => {
    if(window.confirm('Delete this plan?')) {
      setPlans(prev => prev.filter(p => p.id !== planId));
    }
  };

  const handleTogglePlanActive = (planId) => {
    setPlans(prev => prev.map(p => p.id === planId ? { ...p, active: !p.active } : p));
  };

  const handleSetDefaultPlan = (planId, blockId) => {
    setPlans(prev => prev.map(p => {
      if (p.id === planId) {
        return { ...p, defaultForBlockId: blockId };
      }
      if (p.defaultForBlockId === blockId) {
        return { ...p, defaultForBlockId: null };
      }
      return p;
    }));
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Administration & Settings</h2>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Global configuration, backup, and access control</p>
        </div>
        <RefreshButton />
      </div>

      {/* Data Hub */}
      <motion.div className="premium-card" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} style={{ background: 'linear-gradient(135deg, var(--bg-surface) 0%, #eef2ff 100%)', border: '1px solid #c7d2fe' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px', color: '#4338ca' }}>
          <Download size={20} color="#6366f1" /><span>Data Hub & Safety</span>
        </h3>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={exportDataJSON} style={{ background: '#4f46e5', boxShadow: '0 4px 12px rgba(79, 70, 229, 0.25)' }}>
            <Download size={16} /> Export JSON Backup
          </button>
          <label className="btn btn-secondary" style={{ cursor: 'pointer', margin: 0, background: '#fff', border: '1px solid #c7d2fe', color: '#4f46e5' }}>
            <Upload size={16} /> Restore from JSON
            <input type="file" accept=".json" onChange={handleFileUpload} style={{ display: 'none' }} />
          </label>
          <button className="btn btn-ghost" style={{ color: '#ef4444' }} onClick={() => { if (confirm("Reset to demo state? This overwrites all data.")) resetToDemoData(); }}>
            <RefreshCw size={14} /> Factory Reset
          </button>
        </div>
      </motion.div>

      {/* Branding */}
      <motion.div className="premium-card" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Settings size={18} color="var(--brand-primary)" /><span>Branding & Receipts</span>
        </h3>
        <form onSubmit={handleSaveBranding}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            <div className="form-group"><label className="form-label">Library Name</label><input type="text" className="form-input" value={formSettings.name} onChange={(e) => setFormSettings({...formSettings, name: e.target.value})} required /></div>
            <div className="form-group"><label className="form-label">Logo Text / Icon</label><input type="text" className="form-input" value={formSettings.logo} onChange={(e) => setFormSettings({...formSettings, logo: e.target.value})} /></div>
            <div className="form-group"><label className="form-label">Contact Phone</label><input type="text" className="form-input" value={formSettings.phone} onChange={(e) => setFormSettings({...formSettings, phone: e.target.value})} /></div>
            <div className="form-group"><label className="form-label">Contact Email</label><input type="email" className="form-input" value={formSettings.email} onChange={(e) => setFormSettings({...formSettings, email: e.target.value})} /></div>
            <div className="form-group"><label className="form-label">UPI ID (QR)</label><input type="text" className="form-input" value={formSettings.upiId} onChange={(e) => setFormSettings({...formSettings, upiId: e.target.value})} /></div>
            <div className="form-group"><label className="form-label">Tax ID</label><input type="text" className="form-input" value={formSettings.taxId} onChange={(e) => setFormSettings({...formSettings, taxId: e.target.value})} /></div>
          </div>
          <div className="form-group" style={{ marginTop: '16px' }}><label className="form-label">Address</label><input type="text" className="form-input" value={formSettings.address} onChange={(e) => setFormSettings({...formSettings, address: e.target.value})} /></div>
          <div className="form-group" style={{ marginTop: '16px' }}><label className="form-label">Receipt Footer Note</label><input type="text" className="form-input" value={formSettings.receiptFooter} onChange={(e) => setFormSettings({...formSettings, receiptFooter: e.target.value})} /></div>
          
          <div style={{ marginTop: '24px', padding: '16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
            <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '16px' }}>Admission Settings</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label">ID Proof Requirement</label>
                <select className="form-select" value={formSettings.idProofRequirement || 'Optional'} onChange={(e) => setFormSettings({...formSettings, idProofRequirement: e.target.value})}>
                  <option value="Not Required">Not Required</option>
                  <option value="Optional">Optional</option>
                  <option value="Required">Required</option>
                </select>
              </div>
              {formSettings.idProofRequirement !== 'Not Required' && (
                <div className="form-group">
                  <label className="form-label">Submit Later Deadline (Days)</label>
                  <NumericInput className="form-input" value={formSettings.idProofDeadlineDays || 7} onChange={(e) => setFormSettings({...formSettings, idProofDeadlineDays: Number(e.target.value)})} min={1} />
                </div>
              )}
            </div>
          </div>

          <button type="submit" className="btn btn-primary" style={{ marginTop: '16px' }} disabled={!currentStaff?.permissions?.canManageIDProofSettings && currentStaff?.role !== 'Admin'}><Save size={16} /> Save Settings</button>
        </form>
      </motion.div>

      {/* Staff Permissions */}
      <motion.div className="premium-card" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ShieldCheck size={18} color="#8b5cf6" /><span>Staff Permission Matrix</span>
        </h3>
        <div className="table-container">
          <table className="data-grid">
            <thead>
              <tr>
                <th>STAFF MEMBER</th>
                <th>ROLE</th>
                <th style={{ textAlign: 'center', fontSize: '11px' }}>STUDENTS</th>
                <th style={{ textAlign: 'center', fontSize: '11px' }}>PAYMENTS</th>
                <th style={{ textAlign: 'center', fontSize: '11px' }}>SEATS</th>
                <th style={{ textAlign: 'center', fontSize: '11px' }}>EXPENSES</th>
                <th style={{ textAlign: 'center', fontSize: '11px' }}>FINANCIALS</th>
                <th style={{ textAlign: 'center', fontSize: '11px' }}>SETTINGS</th>
                <th style={{ textAlign: 'center', fontSize: '11px' }}>NOTICES</th>
                <th style={{ textAlign: 'center', fontSize: '11px' }}>CANCEL</th>
                <th style={{ textAlign: 'center', fontSize: '11px' }}>REFUND</th>
              </tr>
            </thead>
            <tbody>
              {staffMembers.map(st => (
                <tr key={st.id}>
                  <td><div style={{ fontWeight: 600 }}>{st.name}</div><div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{st.phone}</div></td>
                  <td><span style={{ background: '#f3f4f6', padding: '4px 8px', borderRadius: '4px', fontWeight: 600, fontSize: '12px' }}>{st.role}</span></td>
                  {['canManageStudents', 'canProcessPayments', 'canEditSeats', 'canManageExpenses', 'canViewFinancials', 'canManageIDProofSettings', 'canManageNotices', 'canCancelAdmission', 'canProcessRefunds'].map(permKey => (
                    <td key={permKey} style={{ textAlign: 'center' }}>
                      <input type="checkbox" checked={Boolean(st.permissions?.[permKey])} onChange={() => handleToggleStaffPermission(st.id, permKey)} disabled={st.role === 'Admin'} style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--brand-primary)' }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* Fee Plans Management */}
      <motion.div className="premium-card" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.25 }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Building2 size={18} color="#10b981" /><span>Fee Plans Management</span>
        </h3>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px', marginBottom: '24px' }}>
          {plans.filter(p => activeBranchId === 'all' || p.branchId === activeBranchId).map(p => (
            <div key={p.id} style={{ padding: '16px', background: p.active ? 'var(--bg-surface)' : '#f1f5f9', border: '1px solid var(--border-light)', borderRadius: '8px', opacity: p.active ? 1 : 0.6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h4 style={{ fontSize: '15px', fontWeight: 700 }}>{p.name}</h4>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--brand-primary)', marginTop: '4px' }}>₹{p.price} <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-tertiary)' }}>/ month</span></div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: '12px', color: 'var(--brand-primary)' }} onClick={() => handleEditPlan(p)}>Edit</button>
                  <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: '12px', color: p.active ? 'var(--text-secondary)' : '#10b981' }} onClick={() => handleTogglePlanActive(p.id)}>
                    {p.active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: '12px', color: 'var(--danger-color)' }} onClick={() => handleDeletePlan(p.id)}>Delete</button>
                </div>
              </div>
              <div style={{ marginTop: '12px', fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div><strong>Duration:</strong> {p.durationMonths} Month(s)</div>
                <div><strong>Shifts:</strong> {(p.shiftIds || (p.shiftId ? [p.shiftId] : [])).map(id => shifts.find(s => s.id === id)?.name).filter(Boolean).join(', ') || 'Unknown'}</div>
                <div><strong>Seat:</strong> {seatTypes.find(st => st.id === p.seatTypeId)?.name || 'Unknown'}</div>
                <div><strong>Default:</strong> {p.defaultForBlockId ? `Block ${p.defaultForBlockId}` : 'None'}</div>
              </div>
            </div>
          ))}
        </div>

        <form onSubmit={handleAddPlan} style={{ background: '#f8fafc', padding: '20px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
          <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '16px' }}>{editingPlanId ? 'Edit Plan' : 'Create New Plan'}</h4>
          
          {(() => {
            const targetBranch = activeBranchId === 'all' ? branches[0] : branches.find(b => b.id === activeBranchId);
            const targetBlocks = targetBranch?.blocks || [];
            const validSeatTypes = seatTypes.filter(st => st.blockId === (newPlanBlockId || targetBlocks[0]?.id));

            return (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px' }}>
                <div className="form-group"><label className="form-label">Plan Name</label><input type="text" className="form-input" value={newPlanName} onChange={e => setNewPlanName(e.target.value)} required /></div>
                <div className="form-group"><label className="form-label">Price (₹)</label><NumericInput className="form-input" value={newPlanPrice} onChange={e => setNewPlanPrice(e.target.value)} required /></div>
                <div className="form-group"><label className="form-label">Duration (Months)</label><NumericInput className="form-input" value={newPlanDuration} onChange={e => setNewPlanDuration(Number(e.target.value))} required min={1} /></div>
                
                <div className="form-group"><label className="form-label">Section</label>
                  <select className="form-select" value={newPlanBlockId || targetBlocks[0]?.id || ''} onChange={e => {
                    setNewPlanBlockId(e.target.value);
                    setNewPlanSeatTypeId('');
                  }} required>
                    {targetBlocks.map(sec => <option key={sec.id} value={sec.id}>{sec.name}</option>)}
                  </select>
                </div>

                <div className="form-group"><label className="form-label">Shifts</label>
                  <select multiple className="form-select" style={{ minHeight: '60px' }} value={newPlanShiftIds} onChange={e => {
                    setNewPlanShiftIds(Array.from(e.target.selectedOptions, option => option.value));
                  }} required>
                    {shifts.filter(sh => sh.branchId === targetBranch?.id).map(sh => <option key={sh.id} value={sh.id}>{sh.name}</option>)}
                  </select>
                  <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '4px' }}>Hold Cmd/Ctrl to multi-select</div>
                </div>
                <div className="form-group"><label className="form-label">Seat Type</label>
                  <select className="form-select" value={newPlanSeatTypeId} onChange={e => setNewPlanSeatTypeId(e.target.value)} required>
                    <option value="">Select Seat Type</option>
                    {validSeatTypes.map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
                  </select>
                </div>
              </div>
            );
          })()}
          <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
            <button type="submit" className="btn btn-secondary"><Save size={14} /> {editingPlanId ? 'Save Changes' : 'Add Plan'}</button>
            {editingPlanId && (
              <button type="button" className="btn btn-ghost" onClick={() => { setEditingPlanId(null); setNewPlanName(''); setNewPlanPrice(''); setNewPlanDuration(1); }}>Cancel</button>
            )}
          </div>
        </form>
      </motion.div>

      {/* Branch Manager */}
      <motion.div className="premium-card" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Building2 size={18} color="#f59e0b" /><span>Branch Directory</span>
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
          {branches.map(b => (
            <div key={b.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '16px', background: 'var(--bg-surface)', border: '1px solid var(--border-light)', borderRadius: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <strong style={{ fontSize: '14px' }}>{b.name} ({b.code})</strong>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{b.address}</div>
                </div>
                <span className="badge badge-active">ACTIVE</span>
              </div>
              <div style={{ marginTop: '8px', padding: '12px', background: '#f8fafc', borderRadius: '6px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>BLOCKS & AREAS</div>
                {b.blocks?.map(blk => (
                  <div key={blk.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '4px 0', borderBottom: '1px solid #e2e8f0' }}>
                    <span>{blk.name}</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{blk.totalSeats} Desks {blk.nonFixedSeatEnabled ? ' (+ Non-Fixed)' : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <form onSubmit={handleAddBranch} style={{ background: '#f8fafc', padding: '20px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
          <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '16px' }}>Add Branch</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            <input type="text" className="form-input" placeholder="Branch Name" value={newBranchName} onChange={(e) => setNewBranchName(e.target.value)} required />
            <input type="text" className="form-input" placeholder="Code (e.g. WS)" value={newBranchCode} onChange={(e) => setNewBranchCode(e.target.value)} maxLength={3} required />
            <input type="text" className="form-input" placeholder="Address" value={newBranchAddress} onChange={(e) => setNewBranchAddress(e.target.value)} />
            <NumericInput className="form-input" placeholder="Desks" value={newBranchSeats} onChange={(e) => setNewBranchSeats(e.target.value)} required />
          </div>
          <button type="submit" className="btn btn-secondary" style={{ marginTop: '16px' }}><Plus size={14} /> Add Branch</button>
        </form>
      </motion.div>

    </motion.div>
  );
};
