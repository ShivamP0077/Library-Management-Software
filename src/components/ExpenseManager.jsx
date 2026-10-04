import React, { useState, useEffect } from 'react';
import { useLibrary } from '../context/LibraryContext';
import { Receipt, PlusCircle, X, Download } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { NumericInput } from './NumericInput';

export const ExpenseManager = () => {
  const { expenses, addExpense, branches, activeBranchId, todayStr } = useLibrary();

  const [isAddExpenseModalOpen, setIsAddExpenseModalOpen] = useState(false);
  const [category, setCategory] = useState('Rent');
  const [amount, setAmount] = useState('');
  const [branchId, setBranchId] = useState(activeBranchId === 'all' ? branches[0].id : activeBranchId);
  const [date, setDate] = useState(todayStr);
  const [mode, setMode] = useState('UPI');
  const [notes, setNotes] = useState('');

  const handleCloseExpenseModal = () => {
    if ((amount || notes) && !window.confirm('You have unsaved changes. Are you sure you want to close?')) {
      return;
    }
    setIsAddExpenseModalOpen(false);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isAddExpenseModalOpen) {
        handleCloseExpenseModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAddExpenseModalOpen, amount, notes]);

  const filteredExpenses = expenses.filter(e => {
    if (activeBranchId !== 'all' && e.branchId !== activeBranchId) return false;
    return true;
  });

  const totalExpenseSum = filteredExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  const getBranchCode = (bId) => branches.find(branch => branch.id === bId)?.name || bId;

  const handleCreateExpense = (e) => {
    e.preventDefault();
    if (!amount || Number(amount) <= 0) return;
    addExpense({ branchId, category, amount: Number(amount), date, mode, notes });
    setIsAddExpenseModalOpen(false);
    setAmount('');
    setNotes('');
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Expenses Ledger</h2>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Track operational expenses across branches</p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: '8px 16px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Receipt size={20} color="#ef4444" />
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#b91c1c', letterSpacing: '0.05em' }}>TOTAL EXPENSES</div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#ef4444' }}>₹{totalExpenseSum.toLocaleString()}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button className="btn btn-primary" onClick={() => setIsAddExpenseModalOpen(true)}>
              <PlusCircle size={16} /> Record Expense
            </button>
          </div>
        </div>
      </div>

      {/* Expenses Table */}
      <div className="table-container">
        <table className="data-grid">
          <thead>
            <tr>
              <th>DATE</th>
              <th>CATEGORY</th>
              <th>BRANCH</th>
              <th>AMOUNT</th>
              <th>MODE</th>
              <th>NOTES</th>
            </tr>
          </thead>
          <tbody>
            {filteredExpenses.length === 0 ? (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', padding: '48px', color: 'var(--text-tertiary)' }}>No expenses recorded.</td>
              </tr>
            ) : (
              filteredExpenses.map(exp => (
                <tr key={exp.id}>
                  <td style={{ fontWeight: 500 }}>{exp.date}</td>
                  <td>
                    <span style={{ background: '#f3f4f6', padding: '4px 8px', borderRadius: '4px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '12px' }}>
                      {exp.category}
                    </span>
                  </td>
                  <td style={{ fontSize: '13px', fontWeight: 500 }}>{getBranchCode(exp.branchId)}</td>
                  <td><span style={{ fontWeight: 700, color: '#ef4444' }}>₹{exp.amount.toLocaleString()}</span></td>
                  <td style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{exp.mode}</td>
                  <td style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{exp.notes || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add Expense Modal */}
      <AnimatePresence>
        {isAddExpenseModalOpen && (
          <motion.div className="modal-overlay" onClick={handleCloseExpenseModal} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="modal-content" onClick={(e) => e.stopPropagation()} initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}>
              <div className="modal-header">
                <h3 style={{ fontSize: '18px', fontWeight: 600 }}>Record Operational Expense</h3>
                <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }} onClick={handleCloseExpenseModal} title="Close"><X size={24} /></button>
              </div>
              <form onSubmit={handleCreateExpense}>
                <div className="modal-body">
                  <div style={{ display: 'grid', gridTemplateColumns: branches.length > 1 ? '1fr 1fr' : '1fr', gap: '16px' }}>
                    <div className="form-group">
                      <label className="form-label">Category</label>
                      <select className="form-select" value={category} onChange={(e) => setCategory(e.target.value)}>
                        <option value="Rent">Rent</option>
                        <option value="Electricity">Electricity / AC Bill</option>
                        <option value="Internet / Wifi">Internet / Wifi</option>
                        <option value="Staff Salaries">Staff Salaries</option>
                        <option value="Maintenance">Maintenance & Repairs</option>
                        <option value="Misc">Miscellaneous</option>
                      </select>
                    </div>
                    {branches.length > 1 && (
                      <div className="form-group">
                        <label className="form-label">Branch</label>
                        <select className="form-select" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div className="form-group">
                      <label className="form-label">Amount (₹)</label>
                      <NumericInput className="form-input" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} required />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Mode</label>
                      <select className="form-select" value={mode} onChange={(e) => setMode(e.target.value)}>
                        <option value="UPI">UPI</option>
                        <option value="Bank Transfer">Bank Transfer</option>
                        <option value="Cash">Cash</option>
                        <option value="Card">Card</option>
                      </select>
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Date</label>
                    <input type="date" className="form-input" value={date} onChange={(e) => setDate(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Reference Notes</label>
                    <input type="text" className="form-input" placeholder="e.g. AC repair invoice #89" value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={handleCloseExpenseModal}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Save Expense Record</button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
