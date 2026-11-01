import React, { useEffect, useState } from 'react';
import { useLibrary } from '../context/LibraryContext';
import { BarChart3, TrendingUp, TrendingDown, DollarSign, Receipt, PieChart, Users, Grid, Download } from 'lucide-react';
import { motion } from 'framer-motion';
import { api } from '../utils/api';
import toast from 'react-hot-toast';

const firstOfMonth = (dateStr) => {
  const d = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

export const ReportsManager = () => {
  const { payments, expenses, students, branches, activeBranchId, todayStr } = useLibrary();

  const [fromDate, setFromDate] = useState(() => firstOfMonth(todayStr));
  const [toDate, setToDate] = useState(() => todayStr || new Date().toISOString().split('T')[0]);
  const [serverPnl, setServerPnl] = useState(null);
  const [pnlLoading, setPnlLoading] = useState(false);
  const [pnlError, setPnlError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPnlLoading(true);
    setPnlError(false);
    api.pnl(`?from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}&branchId=${encodeURIComponent(activeBranchId)}`)
      .then(data => {
        if (!cancelled) setServerPnl(data);
      })
      .catch(() => {
        if (!cancelled) {
          setServerPnl(null);
          setPnlError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setPnlLoading(false);
      });
    return () => { cancelled = true; };
  }, [fromDate, toDate, activeBranchId]);

  const handleDownloadCsv = async () => {
    try {
      await api.downloadCsv(
        `/reports/pnl.csv?from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}&branchId=${encodeURIComponent(activeBranchId)}`,
        'pnl.csv'
      );
    } catch (e) {
      toast.error(e.message || 'Download failed');
    }
  };

  const pnlMetrics = serverPnl ? [
    { label: 'FEE COLLECTIONS', value: serverPnl.feeCollections, color: '#10b981' },
    { label: 'REFUNDS', value: serverPnl.refunds, color: '#ef4444' },
    { label: 'NET FEES', value: serverPnl.netFees, color: 'var(--text-primary)' },
    { label: 'ONE-TIME EXPENSES', value: serverPnl.expenses?.oneTime, color: '#ef4444' },
    { label: 'RECURRING BILLS PAID', value: serverPnl.expenses?.recurringPaid, color: '#ef4444' },
    { label: 'NET COLLECTIONS', value: serverPnl.netCollections, color: Number(serverPnl.netCollections) >= 0 ? '#10b981' : '#ef4444' },
    { label: 'RECURRING BILLS OUTSTANDING', value: serverPnl.recurringOutstanding, color: '#f59e0b' },
  ] : [];

  const filteredPayments = payments.filter(p => activeBranchId === 'all' || p.branchId === activeBranchId);
  const filteredExpenses = expenses.filter(e => activeBranchId === 'all' || e.branchId === activeBranchId);
  const filteredStudents = students.filter(s => activeBranchId === 'all' || s.branchId === activeBranchId);

  const totalIncome = filteredPayments.reduce((sum, p) => sum + (p.netTotal || 0), 0);
  const totalExpenses = filteredExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  const netProfitLoss = totalIncome - totalExpenses;

  const methodTotals = { UPI: 0, Cash: 0, Card: 0, 'Bank Transfer': 0 };
  filteredPayments.forEach(p => {
    if (p.method === 'Split' && Array.isArray(p.breakdown)) {
      p.breakdown.forEach(b => {
        const m = b.method || 'Other';
        const amt = Number(b.amount || 0);
        if (methodTotals[m] !== undefined) methodTotals[m] += amt;
        else methodTotals[m] = (methodTotals[m] || 0) + amt;
      });
    } else {
      const m = p.method || 'Other';
      if (methodTotals[m] !== undefined) methodTotals[m] += (p.netTotal || 0);
      else methodTotals[m] = (methodTotals[m] || 0) + (p.netTotal || 0);
    }
  });

  const expenseCategories = {};
  filteredExpenses.forEach(e => {
    expenseCategories[e.category] = (expenseCategories[e.category] || 0) + e.amount;
  });

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: 'flex', flexDirection: 'column', gap: '24px', minWidth: 0 }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Financial Reports</h2>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Profit & Loss statement and financial breakdown</p>
        </div>
      </div>

      {/* Server P&L */}
      <div className="premium-card" style={{ background: 'linear-gradient(135deg, var(--bg-surface) 0%, #f8fafc 100%)', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', marginBottom: '16px', minWidth: 0 }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <TrendingUp size={20} color="var(--brand-primary)" />
              <span>Profit &amp; Loss (server)</span>
            </h3>
            <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>{"This is your library's income and expenses."}</p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={handleDownloadCsv} style={{ flexShrink: 0 }}>
            <Download size={16} /> Download CSV
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', flexWrap: 'wrap', marginBottom: '20px', minWidth: 0 }}>
          <div className="form-group" style={{ marginBottom: 0, minWidth: '140px', flex: '1 1 140px' }}>
            <label className="form-label">From</label>
            <input type="date" className="form-input" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginBottom: 0, minWidth: '140px', flex: '1 1 140px' }}>
            <label className="form-label">To</label>
            <input type="date" className="form-input" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
        </div>

        {pnlLoading ? (
          <div style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>Loading server report…</div>
        ) : pnlError ? (
          <div style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>Server report unavailable</div>
        ) : serverPnl ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '16px', minWidth: 0 }}>
            {pnlMetrics.map(metric => (
              <div key={metric.label} style={{ padding: '16px', background: 'var(--bg-surface)', borderRadius: '10px', border: '1px solid var(--border-light)', minWidth: 0 }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>{metric.label}</div>
                <div style={{ fontSize: '22px', fontWeight: 800, color: metric.color, marginTop: '6px', overflowWrap: 'anywhere' }}>
                  ₹{Number(metric.value || 0).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* P&L Executive Summary */}
      <div className="premium-card" style={{ background: 'linear-gradient(135deg, var(--bg-surface) 0%, #f8fafc 100%)' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <BarChart3 size={20} color="var(--brand-primary)" />
          <span>Executive Summary (P&L)</span>
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
          
          <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 }} style={{ padding: '24px', background: 'var(--bg-surface)', borderRadius: '12px', border: '1px solid var(--border-light)', boxShadow: '0 4px 6px rgba(16, 185, 129, 0.05)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>TOTAL COLLECTIONS</div>
            <div style={{ fontSize: '32px', fontWeight: 800, color: '#10b981', margin: '8px 0' }}>₹{totalIncome.toLocaleString()}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>From {filteredPayments.length} transactions</div>
          </motion.div>

          <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }} style={{ padding: '24px', background: 'var(--bg-surface)', borderRadius: '12px', border: '1px solid var(--border-light)', boxShadow: '0 4px 6px rgba(239, 68, 68, 0.05)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>TOTAL EXPENSES</div>
            <div style={{ fontSize: '32px', fontWeight: 800, color: '#ef4444', margin: '8px 0' }}>₹{totalExpenses.toLocaleString()}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>From {filteredExpenses.length} expense logs</div>
          </motion.div>

          <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }} style={{ padding: '24px', background: 'var(--bg-surface)', borderRadius: '12px', border: `1px solid ${netProfitLoss >= 0 ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`, boxShadow: `0 4px 12px ${netProfitLoss >= 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)'}` }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>NET PROFIT / LOSS</div>
            <div style={{ fontSize: '32px', fontWeight: 800, color: netProfitLoss >= 0 ? '#10b981' : '#ef4444', margin: '8px 0' }}>₹{netProfitLoss.toLocaleString()}</div>
            <div style={{ fontSize: '13px', color: netProfitLoss >= 0 ? '#10b981' : '#ef4444', fontWeight: 600 }}>
              {netProfitLoss >= 0 ? '▲ Operating Surplus' : '▼ Operating Deficit'}
            </div>
          </motion.div>

        </div>
      </div>

      {/* Analytical Breakdown Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '24px' }}>
        
        <motion.div className="premium-card" initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.4 }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <DollarSign size={18} color="#10b981" />
            <span>Income by Payment Method</span>
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {Object.entries(methodTotals).map(([method, amount], i) => {
              const percent = totalIncome > 0 ? Math.round((amount / totalIncome) * 100) : 0;
              return (
                <div key={method}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontWeight: 500, fontSize: '14px' }}>{method}</span>
                    <span style={{ fontWeight: 600, color: '#10b981' }}>₹{amount.toLocaleString()} <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>({percent}%)</span></span>
                  </div>
                  <div style={{ width: '100%', height: '8px', background: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
                    <motion.div initial={{ width: 0 }} animate={{ width: `${percent}%` }} transition={{ duration: 1, delay: 0.5 + (i * 0.1) }} style={{ height: '100%', background: '#10b981', borderRadius: '4px' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>

        <motion.div className="premium-card" initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.5 }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Receipt size={18} color="#ef4444" />
            <span>Expenses by Category</span>
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {Object.keys(expenseCategories).length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-tertiary)' }}>No expense data recorded.</div>
            ) : (
              Object.entries(expenseCategories).map(([cat, amt], i) => {
                const percent = totalExpenses > 0 ? Math.round((amt / totalExpenses) * 100) : 0;
                return (
                  <div key={cat}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span style={{ fontWeight: 500, fontSize: '14px' }}>{cat}</span>
                      <span style={{ fontWeight: 600, color: '#ef4444' }}>₹{amt.toLocaleString()} <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>({percent}%)</span></span>
                    </div>
                    <div style={{ width: '100%', height: '8px', background: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
                      <motion.div initial={{ width: 0 }} animate={{ width: `${percent}%` }} transition={{ duration: 1, delay: 0.6 + (i * 0.1) }} style={{ height: '100%', background: '#ef4444', borderRadius: '4px' }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </motion.div>

      </div>
    </motion.div>
  );
};
