import React from 'react';
import { useLibrary } from '../context/LibraryContext';
import { BarChart3, TrendingUp, TrendingDown, DollarSign, Receipt, PieChart, Users, Grid } from 'lucide-react';
import { motion } from 'framer-motion';

export const ReportsManager = () => {
  const { payments, expenses, students, branches, activeBranchId } = useLibrary();

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
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Financial Reports</h2>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Profit & Loss statement and financial breakdown</p>
        </div>
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
