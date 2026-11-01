import React, { useState, useEffect } from 'react';
import { useLibrary } from '../context/LibraryContext';
import { Receipt, PlusCircle, X, RefreshCw, Pencil } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { NumericInput } from './NumericInput';
import { api } from '../utils/api';
import toast from 'react-hot-toast';

const CUSTOM_CATEGORY = '__custom__';

const FREQUENCY_LABELS = {
  monthly: 'Monthly',
  every_2_months: 'Every 2 months',
  quarterly: 'Quarterly',
  half_yearly: 'Every 6 months',
  yearly: 'Yearly',
  custom: 'Custom',
};

const frequencyText = (template) => {
  if (template.frequency === 'custom') {
    const months = Number(template.intervalMonths || 1);
    return `Every ${months} month${months === 1 ? '' : 's'}`;
  }
  return FREQUENCY_LABELS[template.frequency] || template.frequency || '—';
};

const STATUS_STYLES = {
  paid: { background: '#dcfce7', color: '#166534', label: 'Paid' },
  part_paid: { background: '#fef3c7', color: '#92400e', label: 'Part-paid' },
  unpaid: { background: '#f3f4f6', color: '#6b7280', label: 'Unpaid' },
  overdue: { background: '#fee2e2', color: '#991b1b', label: 'Overdue' },
};

export const ExpenseManager = () => {
  const { expenses, addExpense, branches, activeBranchId, todayStr } = useLibrary();

  const todayDate = todayStr || new Date().toISOString().split('T')[0];
  const todayDay = Number(todayDate.split('-')[2]) || 1;

  const [activeTab, setActiveTab] = useState('ledger');

  const [isAddExpenseModalOpen, setIsAddExpenseModalOpen] = useState(false);
  const [expenseType, setExpenseType] = useState('one_time');
  const [category, setCategory] = useState('Rent');
  const [customCategory, setCustomCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [branchId, setBranchId] = useState(activeBranchId === 'all' ? (branches[0]?.id || '') : activeBranchId);
  const [date, setDate] = useState(todayDate);
  const [mode, setMode] = useState('UPI');
  const [notes, setNotes] = useState('');

  const [frequency, setFrequency] = useState('monthly');
  const [intervalMonths, setIntervalMonths] = useState('2');
  const [startDate, setStartDate] = useState(todayDate);
  const [dueDay, setDueDay] = useState(String(todayDay));
  const [endDate, setEndDate] = useState('');
  const [reminderDaysBefore, setReminderDaysBefore] = useState('3');
  const [reminderOnDue, setReminderOnDue] = useState(true);
  const [reminderRepeatEveryDays, setReminderRepeatEveryDays] = useState('3');
  const [saving, setSaving] = useState(false);

  const [instances, setInstances] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [recurringLoading, setRecurringLoading] = useState(false);
  const [highlightId, setHighlightId] = useState(null);

  const [payInstance, setPayInstance] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(todayDate);
  const [payMode, setPayMode] = useState('Cash');
  const [paySaving, setPaySaving] = useState(false);

  const [editInstance, setEditInstance] = useState(null);
  const [editAmount, setEditAmount] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const resolvedCategory = category === CUSTOM_CATEGORY ? customCategory.trim() : category;

  const loadRecurring = async () => {
    setRecurringLoading(true);
    try {
      const [instanceList, templateList] = await Promise.all([
        api.expenseInstances(),
        api.recurringExpenses(),
      ]);
      setInstances(Array.isArray(instanceList) ? instanceList : []);
      setTemplates(Array.isArray(templateList) ? templateList : []);
    } catch (e) {
      toast.error(e.message || 'Could not load recurring bills');
    } finally {
      setRecurringLoading(false);
    }
  };

  useEffect(() => {
    loadRecurring();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const applyHash = () => {
      const match = window.location.hash.match(/expense-instance=([^&]+)/);
      if (match) {
        setHighlightId(decodeURIComponent(match[1]));
        setActiveTab('recurring');
      }
    };
    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, []);

  useEffect(() => {
    if (!highlightId || recurringLoading) return;
    const el = document.getElementById(`expense-instance-${highlightId}`);
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightId, recurringLoading, instances]);

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

  const filteredInstances = instances.filter(i => activeBranchId === 'all' || i.branchId === activeBranchId);
  const filteredTemplates = templates.filter(t => activeBranchId === 'all' || t.branchId === activeBranchId);

  const totalExpenseSum = filteredExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  const getBranchCode = (bId) => branches.find(branch => branch.id === bId)?.name || bId;

  const handleCreateExpense = async (e) => {
    e.preventDefault();
    if (!resolvedCategory) {
      toast.error('Please choose or enter a category');
      return;
    }
    const numericAmount = Number(amount);
    if (!amount || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      toast.error('Enter a valid amount');
      return;
    }

    if (expenseType === 'one_time') {
      addExpense({ branchId, category: resolvedCategory, amount: numericAmount, date, mode, notes });
      setIsAddExpenseModalOpen(false);
      setAmount('');
      setNotes('');
      return;
    }

    if (!startDate) {
      toast.error('Start date is required');
      return;
    }
    if (frequency === 'custom' && !(Number(intervalMonths) >= 1)) {
      toast.error('Enter an interval of at least 1 month');
      return;
    }
    if (!(Number(dueDay) >= 1 && Number(dueDay) <= 31)) {
      toast.error('Due day must be between 1 and 31');
      return;
    }

    setSaving(true);
    try {
      await api.createRecurringExpense({
        category: resolvedCategory,
        amount: numericAmount,
        frequency,
        intervalMonths: frequency === 'custom' ? Number(intervalMonths) : undefined,
        startDate,
        dueDay: Number(dueDay),
        endDate: endDate || undefined,
        description: notes,
        branchId,
        reminder: {
          daysBefore: Number(reminderDaysBefore),
          onDue: reminderOnDue,
          repeatEveryDays: Number(reminderRepeatEveryDays),
        },
      });
      toast.success('Recurring bill created');
      setIsAddExpenseModalOpen(false);
      setAmount('');
      setNotes('');
      setActiveTab('recurring');
      await loadRecurring();
    } catch (err) {
      toast.error(err.message || 'Could not create recurring bill');
    } finally {
      setSaving(false);
    }
  };

  const openPayModal = (instance) => {
    const remaining = Math.max(0, Number(instance.amount || 0) - Number(instance.paidAmount || 0));
    setPayInstance(instance);
    setPayAmount(String(remaining));
    setPayDate(todayDate);
    setPayMode('Cash');
  };

  const handlePaySubmit = async (e) => {
    e.preventDefault();
    const numericAmount = Number(payAmount);
    if (!(numericAmount > 0) || !Number.isInteger(numericAmount)) {
      toast.error('Enter a positive whole amount');
      return;
    }
    setPaySaving(true);
    try {
      await api.payExpenseInstance(payInstance.id, { amount: numericAmount, date: payDate, mode: payMode });
      toast.success('Payment recorded');
      setPayInstance(null);
      await loadRecurring();
    } catch (err) {
      toast.error(err.message || 'Could not record payment');
    } finally {
      setPaySaving(false);
    }
  };

  const openEditModal = (instance) => {
    setEditInstance(instance);
    setEditAmount(String(instance.amount ?? ''));
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    const numericAmount = Number(editAmount);
    if (!(numericAmount >= 0)) {
      toast.error('Enter a valid amount');
      return;
    }
    setEditSaving(true);
    try {
      await api.updateExpenseInstance(editInstance.id, { amount: numericAmount });
      toast.success('Bill amount updated');
      setEditInstance(null);
      await loadRecurring();
    } catch (err) {
      toast.error(err.message || 'Could not update bill amount');
    } finally {
      setEditSaving(false);
    }
  };

  const handleStopTemplate = async (template) => {
    if (!window.confirm(`Stop recurring bill "${template.category}"? No new bills will be generated.`)) return;
    try {
      await api.stopRecurringExpense(template.id);
      toast.success('Recurring bill stopped');
      await loadRecurring();
    } catch (err) {
      toast.error(err.message || 'Could not stop recurring bill');
    }
  };

  const toggleStyle = (active) => ({
    background: active ? '#ffffff' : 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
    border: 'none',
    borderRadius: '6px',
    padding: '6px 14px',
    fontSize: '13px',
    fontWeight: active ? 700 : 500,
    cursor: 'pointer',
    boxShadow: active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
  });

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: 'flex', flexDirection: 'column', gap: '24px', minWidth: 0 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px', minWidth: 0 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Expenses Ledger</h2>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Track operational expenses across branches</p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', minWidth: 0 }}>
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

      {/* Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', borderBottom: '1px solid var(--border-light)', minWidth: 0 }}>
        {[
          { id: 'ledger', label: 'Ledger' },
          { id: 'recurring', label: 'Recurring bills' },
        ].map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '10px 4px',
              marginBottom: '-1px',
              borderBottom: activeTab === tab.id ? '2px solid var(--brand-primary)' : '2px solid transparent',
              color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: activeTab === tab.id ? 700 : 500,
              fontSize: '14px',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Expenses Table */}
      {activeTab === 'ledger' && (
        <div className="table-container" style={{ minWidth: 0 }}>
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
      )}

      {/* Recurring bills */}
      {activeTab === 'recurring' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap', minWidth: 0 }}>
            <div style={{ minWidth: 0 }}>
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>Recurring bills</h3>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Bills generated from your recurring expense templates</p>
            </div>
            <button type="button" className="btn btn-secondary" onClick={loadRecurring} disabled={recurringLoading}>
              <RefreshCw size={16} /> {recurringLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>

          <div className="table-container" style={{ minWidth: 0 }}>
            <table className="data-grid">
              <thead>
                <tr>
                  <th>CATEGORY</th>
                  <th>DESCRIPTION</th>
                  <th>DUE DATE</th>
                  <th>AMOUNT</th>
                  <th>PAID</th>
                  <th>STATUS</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {recurringLoading && filteredInstances.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', padding: '48px', color: 'var(--text-tertiary)' }}>Loading recurring bills…</td>
                  </tr>
                ) : filteredInstances.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', padding: '48px', color: 'var(--text-tertiary)' }}>No recurring bills yet.</td>
                  </tr>
                ) : (
                  filteredInstances.map(instance => {
                    const status = STATUS_STYLES[instance.status] || STATUS_STYLES.unpaid;
                    const remaining = Math.max(0, Number(instance.amount || 0) - Number(instance.paidAmount || 0));
                    const highlighted = highlightId === instance.id;
                    const cellStyle = highlighted ? { background: '#fef9c3' } : undefined;
                    return (
                      <tr key={instance.id} id={`expense-instance-${instance.id}`}>
                        <td style={cellStyle}>
                          <span style={{ background: '#f3f4f6', padding: '4px 8px', borderRadius: '4px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '12px' }}>
                            {instance.category || '—'}
                          </span>
                        </td>
                        <td style={{ ...cellStyle, fontSize: '13px', color: 'var(--text-secondary)', maxWidth: '220px' }}>{instance.description || '—'}</td>
                        <td style={{ ...cellStyle, fontWeight: 500 }}>{instance.dueDate || '—'}</td>
                        <td style={cellStyle}><span style={{ fontWeight: 700, color: '#ef4444' }}>₹{Number(instance.amount || 0).toLocaleString()}</span></td>
                        <td style={cellStyle}><span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>₹{Number(instance.paidAmount || 0).toLocaleString()}</span></td>
                        <td style={cellStyle}>
                          <span style={{ background: status.background, color: status.color, padding: '4px 8px', borderRadius: '999px', fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {status.label}
                          </span>
                        </td>
                        <td style={cellStyle}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn btn-primary"
                              style={{ padding: '4px 10px', fontSize: '12px' }}
                              onClick={() => openPayModal(instance)}
                              disabled={remaining <= 0}
                            >
                              Pay
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ padding: '4px 10px', fontSize: '12px' }}
                              onClick={() => openEditModal(instance)}
                            >
                              <Pencil size={12} /> Edit amount
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="premium-card" style={{ padding: '20px', minWidth: 0 }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>Recurring templates</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Manage the schedules that generate bills.</p>
            {recurringLoading && filteredTemplates.length === 0 ? (
              <div style={{ padding: '16px 0', color: 'var(--text-tertiary)', fontSize: '13px' }}>Loading recurring templates…</div>
            ) : filteredTemplates.length === 0 ? (
              <div style={{ padding: '16px 0', color: 'var(--text-tertiary)', fontSize: '13px' }}>No recurring templates yet.</div>
            ) : (
              filteredTemplates.map(template => (
                <div
                  key={template.id}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', padding: '12px 0', borderTop: '1px solid var(--border-light)', minWidth: 0 }}
                >
                  <div style={{ minWidth: 0, flex: '1 1 220px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{template.category}</span>
                      {template.status === 'stopped' && (
                        <span style={{ background: '#f3f4f6', color: '#6b7280', padding: '3px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: 600 }}>
                          Stopped
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px', overflowWrap: 'anywhere' }}>
                      {frequencyText(template)} · ₹{Number(template.amount || 0).toLocaleString()} · due day {template.dueDay || '—'}
                      {template.endDate ? ` · ends ${template.endDate}` : ''}
                    </div>
                  </div>
                  {template.status !== 'stopped' && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '4px 10px', fontSize: '12px' }}
                      onClick={() => handleStopTemplate(template)}
                    >
                      Stop
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Add Expense / Recurring Modal */}
      <AnimatePresence>
        {isAddExpenseModalOpen && (
          <motion.div className="modal-overlay" onClick={handleCloseExpenseModal} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="modal-content" onClick={(e) => e.stopPropagation()} initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} style={{ maxWidth: '560px' }}>
              <div className="modal-header">
                <h3 style={{ fontSize: '18px', fontWeight: 600 }}>{expenseType === 'recurring' ? 'Create Recurring Bill' : 'Record Operational Expense'}</h3>
                <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }} onClick={handleCloseExpenseModal} title="Close"><X size={24} /></button>
              </div>
              <form onSubmit={handleCreateExpense}>
                <div className="modal-body">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#f3f4f6', padding: '4px', borderRadius: '8px', marginBottom: '16px', width: 'fit-content', maxWidth: '100%', flexWrap: 'wrap' }}>
                    <button type="button" onClick={() => setExpenseType('one_time')} style={toggleStyle(expenseType === 'one_time')}>One-time</button>
                    <button type="button" onClick={() => setExpenseType('recurring')} style={toggleStyle(expenseType === 'recurring')}>Recurring</button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: branches.length > 1 ? '1fr 1fr' : '1fr', gap: '16px', minWidth: 0 }}>
                    <div className="form-group" style={{ minWidth: 0 }}>
                      <label className="form-label">Category</label>
                      <select className="form-select" value={category} onChange={(e) => setCategory(e.target.value)}>
                        <option value="Rent">Rent</option>
                        <option value="Electricity">Electricity / AC Bill</option>
                        <option value="Internet / Wifi">Internet / Wifi</option>
                        <option value="Staff Salaries">Staff Salaries</option>
                        <option value="Maintenance">Maintenance & Repairs</option>
                        <option value="Misc">Miscellaneous</option>
                        <option value={CUSTOM_CATEGORY}>Custom…</option>
                      </select>
                      {category === CUSTOM_CATEGORY && (
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Enter category name"
                          value={customCategory}
                          onChange={(e) => setCustomCategory(e.target.value)}
                          required
                          style={{ marginTop: '8px' }}
                        />
                      )}
                    </div>
                    {branches.length > 1 && (
                      <div className="form-group" style={{ minWidth: 0 }}>
                        <label className="form-label">Branch</label>
                        <select className="form-select" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', minWidth: 0 }}>
                    <div className="form-group" style={{ minWidth: 0 }}>
                      <label className="form-label">Amount (₹)</label>
                      <NumericInput
                        className="form-input"
                        placeholder="0.00"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        required
                        allowDecimal={expenseType === 'one_time'}
                      />
                    </div>
                    {expenseType === 'one_time' ? (
                      <div className="form-group" style={{ minWidth: 0 }}>
                        <label className="form-label">Mode</label>
                        <select className="form-select" value={mode} onChange={(e) => setMode(e.target.value)}>
                          <option value="UPI">UPI</option>
                          <option value="Bank Transfer">Bank Transfer</option>
                          <option value="Cash">Cash</option>
                          <option value="Card">Card</option>
                        </select>
                      </div>
                    ) : (
                      <div className="form-group" style={{ minWidth: 0 }}>
                        <label className="form-label">Frequency</label>
                        <select className="form-select" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                          <option value="monthly">Monthly</option>
                          <option value="every_2_months">Every 2 months</option>
                          <option value="quarterly">Quarterly</option>
                          <option value="half_yearly">Every 6 months</option>
                          <option value="yearly">Yearly</option>
                          <option value="custom">Custom</option>
                        </select>
                      </div>
                    )}
                  </div>

                  {expenseType === 'recurring' && frequency === 'custom' && (
                    <div className="form-group" style={{ minWidth: 0 }}>
                      <label className="form-label">Every N months</label>
                      <input
                        type="number"
                        className="form-input"
                        min="1"
                        step="1"
                        value={intervalMonths}
                        onChange={(e) => setIntervalMonths(e.target.value)}
                        required
                      />
                    </div>
                  )}

                  {expenseType === 'one_time' ? (
                    <div className="form-group" style={{ minWidth: 0 }}>
                      <label className="form-label">Date</label>
                      <input type="date" className="form-input" value={date} onChange={(e) => setDate(e.target.value)} />
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', minWidth: 0 }}>
                        <div className="form-group" style={{ minWidth: 0 }}>
                          <label className="form-label">Start date</label>
                          <input type="date" className="form-input" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
                        </div>
                        <div className="form-group" style={{ minWidth: 0 }}>
                          <label className="form-label">Due day of month</label>
                          <input
                            type="number"
                            className="form-input"
                            min="1"
                            max="31"
                            step="1"
                            value={dueDay}
                            onChange={(e) => setDueDay(e.target.value)}
                            required
                          />
                        </div>
                      </div>
                      <div className="form-group" style={{ minWidth: 0 }}>
                        <label className="form-label">End date (optional)</label>
                        <input
                          type="date"
                          className="form-input"
                          value={endDate}
                          min={startDate || undefined}
                          onChange={(e) => setEndDate(e.target.value)}
                        />
                      </div>
                    </>
                  )}

                  <div className="form-group">
                    <label className="form-label">{expenseType === 'recurring' ? 'Description' : 'Reference Notes'}</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder={expenseType === 'recurring' ? 'e.g. Monthly internet bill' : 'e.g. AC repair invoice #89'}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </div>

                  {expenseType === 'recurring' && (
                    <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '16px', marginTop: '4px', minWidth: 0 }}>
                      <h4 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '12px', color: 'var(--text-primary)' }}>Reminder settings</h4>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', minWidth: 0 }}>
                        <div className="form-group" style={{ minWidth: 0 }}>
                          <label className="form-label">Days before due</label>
                          <input
                            type="number"
                            className="form-input"
                            min="0"
                            step="1"
                            value={reminderDaysBefore}
                            onChange={(e) => setReminderDaysBefore(e.target.value)}
                          />
                        </div>
                        <div className="form-group" style={{ minWidth: 0 }}>
                          <label className="form-label">Repeat every N days after due</label>
                          <input
                            type="number"
                            className="form-input"
                            min="0"
                            step="1"
                            value={reminderRepeatEveryDays}
                            onChange={(e) => setReminderRepeatEveryDays(e.target.value)}
                          />
                        </div>
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                        <input type="checkbox" checked={reminderOnDue} onChange={(e) => setReminderOnDue(e.target.checked)} />
                        Remind on due date
                      </label>
                    </div>
                  )}
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={handleCloseExpenseModal}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? 'Saving…' : expenseType === 'recurring' ? 'Create Recurring Bill' : 'Save Expense Record'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pay Bill Modal */}
      <AnimatePresence>
        {payInstance && (
          <motion.div className="modal-overlay" onClick={() => { if (!paySaving) setPayInstance(null); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="modal-content" onClick={(e) => e.stopPropagation()} initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} style={{ maxWidth: '420px' }}>
              <div className="modal-header">
                <h3 style={{ fontSize: '18px', fontWeight: 600 }}>Pay bill</h3>
                <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }} onClick={() => setPayInstance(null)} title="Close"><X size={24} /></button>
              </div>
              <form onSubmit={handlePaySubmit}>
                <div className="modal-body">
                  <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px', overflowWrap: 'anywhere' }}>
                    {payInstance.category || 'Bill'} · due {payInstance.dueDate || '—'} · remaining ₹{Math.max(0, Number(payInstance.amount || 0) - Number(payInstance.paidAmount || 0)).toLocaleString()}
                  </p>
                  <div className="form-group">
                    <label className="form-label">Amount (₹)</label>
                    <NumericInput className="form-input" allowDecimal={false} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} required />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', minWidth: 0 }}>
                    <div className="form-group" style={{ minWidth: 0 }}>
                      <label className="form-label">Date</label>
                      <input type="date" className="form-input" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
                    </div>
                    <div className="form-group" style={{ minWidth: 0 }}>
                      <label className="form-label">Mode</label>
                      <select className="form-select" value={payMode} onChange={(e) => setPayMode(e.target.value)}>
                        <option value="Cash">Cash</option>
                        <option value="UPI">UPI</option>
                        <option value="Card">Card</option>
                        <option value="Bank Transfer">Bank Transfer</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setPayInstance(null)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={paySaving}>{paySaving ? 'Saving…' : 'Record Payment'}</button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Amount Modal */}
      <AnimatePresence>
        {editInstance && (
          <motion.div className="modal-overlay" onClick={() => { if (!editSaving) setEditInstance(null); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="modal-content" onClick={(e) => e.stopPropagation()} initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} style={{ maxWidth: '380px' }}>
              <div className="modal-header">
                <h3 style={{ fontSize: '18px', fontWeight: 600 }}>Edit bill amount</h3>
                <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }} onClick={() => setEditInstance(null)} title="Close"><X size={24} /></button>
              </div>
              <form onSubmit={handleEditSubmit}>
                <div className="modal-body">
                  <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px', overflowWrap: 'anywhere' }}>
                    {editInstance.category || 'Bill'} · due {editInstance.dueDate || '—'}
                  </p>
                  <div className="form-group">
                    <label className="form-label">Amount (₹)</label>
                    <NumericInput className="form-input" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} required />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setEditInstance(null)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={editSaving}>{editSaving ? 'Saving…' : 'Save Amount'}</button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
