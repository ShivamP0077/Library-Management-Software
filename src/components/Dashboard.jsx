import React, { useState, useMemo } from 'react';
import { useLibrary } from '../context/LibraryContext';
import { motion } from 'framer-motion';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { 
  Users, DollarSign, Calendar, AlertTriangle, CheckCircle2, 
  TrendingUp, TrendingDown, Clock, Grid, UserPlus, CreditCard, ChevronRight,
  Building2, ArrowRight
} from 'lucide-react';

const AnimatedNumber = ({ value, prefix = '', suffix = '' }) => {
  return (
    <motion.span
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, type: 'spring' }}
    >
      {prefix}{value.toLocaleString()}{suffix}
    </motion.span>
  );
};

const KpiCard = ({ title, value, prefix, suffix, icon: Icon, color, delay = 0, onClick }) => (
  <motion.div
    className="premium-card"
    onClick={onClick}
    style={{ cursor: onClick ? 'pointer' : 'default', position: 'relative', overflow: 'hidden' }}
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5, delay }}
  >
    <div style={{ position: 'absolute', top: -20, right: -20, opacity: 0.05, color: color }}>
      <Icon size={120} />
    </div>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
      <span style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '0.05em' }}>{title}</span>
      <div style={{ padding: '8px', background: `${color}15`, borderRadius: '8px', color: color }}>
        <Icon size={16} />
      </div>
    </div>
    <div style={{ fontSize: '32px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '16px' }}>
      <AnimatedNumber value={value} prefix={prefix} suffix={suffix} />
    </div>
  </motion.div>
);

export const Dashboard = ({ 
  setActiveTab, 
  onOpenNewStudent, 
  onSelectStudent, 
  onTriggerRenew,
  onHandleIntegrityAction,
  onOpenSetupWizard 
}) => {
  const { 
    settings, students, payments, expenses, branches, activeBranchId, todayStr,
    plans, shifts, seatTypes, seats, checkDataIntegrity, getSetupStatus
  } = useLibrary();

  const [showAllIssues, setShowAllIssues] = useState(false);

  const setupStatus = getSetupStatus ? getSetupStatus() : (settings.isSetupComplete ? 'COMPLETED' : 'NOT_STARTED');

  const filteredStudents = activeBranchId === 'all' ? students : students.filter(s => s.branchId === activeBranchId);
  const filteredPayments = activeBranchId === 'all' ? payments : payments.filter(p => p.branchId === activeBranchId);
  const filteredExpenses = activeBranchId === 'all' ? expenses : expenses.filter(e => e.branchId === activeBranchId);

  const todaysAdmissionsCount = filteredStudents.filter(s => s.joinedDate === todayStr).length;
  const todaysCollectionsTotal = filteredPayments.filter(p => p.date === todayStr).reduce((sum, p) => sum + (p.netTotal || 0), 0);
  
  const activeStudentsCount = filteredStudents.filter(s => s.status === 'Active' || s.status === 'Expiring Soon').length;
  const expiringSoonCount = filteredStudents.filter(s => s.status === 'Expiring Soon').length;
  const expiredCount = filteredStudents.filter(s => s.status === 'Expired').length;

  const totalBranchSeats = activeBranchId === 'all'
    ? (seats?.length > 0 ? seats.length : branches.reduce((sum, b) => sum + (b.totalSeats || 0), 0))
    : ((seats || []).filter(s => s.branchId === activeBranchId).length || branches.find(b => b.id === activeBranchId)?.totalSeats || 0);
  const seatOccupancyPercent = totalBranchSeats > 0 ? Math.min(100, Math.round((activeStudentsCount / totalBranchSeats) * 100)) : 0;

  const currentMonthPrefix = todayStr.substring(0, 7);
  const monthlyIncome = filteredPayments.filter(p => p.date.startsWith(currentMonthPrefix)).reduce((sum, p) => sum + (p.netTotal || 0), 0);
  const monthlyExpensesTotal = filteredExpenses.filter(e => e.date.startsWith(currentMonthPrefix)).reduce((sum, e) => sum + (e.amount || 0), 0);
  const monthlyNetProfit = monthlyIncome - monthlyExpensesTotal;

  // Chart Data
  const chartData = useMemo(() => {
    const data = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayIncome = filteredPayments.filter(p => p.date === dateStr).reduce((s, p) => s + (p.netTotal || 0), 0);
      const dayExpense = filteredExpenses.filter(e => e.date === dateStr).reduce((s, e) => s + (e.amount || 0), 0);
      data.push({
        name: d.toLocaleDateString('en-US', { weekday: 'short' }),
        Income: dayIncome,
        Expense: dayExpense
      });
    }
    return data;
  }, [filteredPayments, filteredExpenses]);

  // Central Data Integrity Checks (Exact same source as Library Settings)
  const integrityIssues = useMemo(() => {
    return checkDataIntegrity ? checkDataIntegrity() : [];
  }, [students, plans, shifts, seatTypes, branches, seats, checkDataIntegrity]);

  return (
    <motion.div 
      style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>Overview</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '4px' }}>Real-time metrics for {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button className="btn btn-primary" onClick={onOpenNewStudent}>
            <UserPlus size={16} /> New Admission
          </button>
        </div>
      </div>

      {/* ======================================================== */}
      {/* 1. SETUP WIZARD CTA (Separate from Action Required)     */}
      {/* ======================================================== */}
      {setupStatus === 'NOT_STARTED' && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }} 
          animate={{ opacity: 1, y: 0 }} 
          style={{ 
            background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '12px', 
            padding: '16px 20px', display: 'flex', justifyContent: 'space-between', 
            alignItems: 'center', flexWrap: 'wrap', gap: '16px', boxShadow: '0 2px 8px rgba(37,99,235,0.06)' 
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ background: '#dbeafe', color: '#1d4ed8', padding: '10px', borderRadius: '10px' }}>
              <Building2 size={24} />
            </div>
            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1e40af', margin: 0 }}>
                ⚙ Start Library Setup
              </h3>
              <p style={{ fontSize: '13px', color: '#1e3a8a', margin: '3px 0 0 0' }}>
                Your library setup has not been initialized. Launch the 8-step wizard to configure branches, seat types, shifts, and fee plans.
              </p>
            </div>
          </div>
          <button 
            type="button" 
            className="btn btn-primary" 
            style={{ background: '#2563eb', padding: '8px 18px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
            onClick={() => onOpenSetupWizard ? onOpenSetupWizard(false) : setActiveTab('settings')}
          >
            <span>⚙ Start Library Setup</span>
            <ArrowRight size={15} />
          </button>
        </motion.div>
      )}

      {setupStatus === 'DRAFT' && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }} 
          animate={{ opacity: 1, y: 0 }} 
          style={{ 
            background: '#fefce8', border: '1px solid #fef08a', borderRadius: '12px', 
            padding: '16px 20px', display: 'flex', justifyContent: 'space-between', 
            alignItems: 'center', flexWrap: 'wrap', gap: '16px', boxShadow: '0 2px 8px rgba(202,138,4,0.06)' 
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ background: '#fef9c3', color: '#854d0e', padding: '10px', borderRadius: '10px' }}>
              <Building2 size={24} />
            </div>
            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#854d0e', margin: 0 }}>
                ⚙ Finish Library Setup
              </h3>
              <p style={{ fontSize: '13px', color: '#713f12', margin: '3px 0 0 0' }}>
                Your setup is in progress. Continue from your saved draft and step to complete setup.
              </p>
            </div>
          </div>
          <button 
            type="button" 
            className="btn btn-primary" 
            style={{ background: '#ca8a04', padding: '8px 18px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
            onClick={() => onOpenSetupWizard ? onOpenSetupWizard(false) : setActiveTab('settings')}
          >
            <span>⚙ Continue Setup</span>
            <ArrowRight size={15} />
          </button>
        </motion.div>
      )}

      {/* ======================================================== */}
      {/* 2. ACTION REQUIRED BANNER (Fully Actionable Issue Cards) */}
      {/* ======================================================== */}
      {integrityIssues.length > 0 && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }} 
          animate={{ opacity: 1, y: 0 }} 
          style={{ 
            background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '12px', 
            padding: '18px 20px', display: 'flex', gap: '16px', alignItems: 'flex-start' 
          }}
        >
          <AlertTriangle size={24} color="#dc2626" style={{ marginTop: '2px', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '4px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#991b1b', margin: 0 }}>
                ⚠️ Action Required: Data Inconsistencies Detected ({integrityIssues.length})
              </h3>
              {integrityIssues.length > 4 && (
                <button 
                  type="button"
                  className="btn btn-ghost" 
                  style={{ fontSize: '12px', color: '#991b1b', padding: '2px 8px', textDecoration: 'underline', fontWeight: 600 }}
                  onClick={() => setShowAllIssues(!showAllIssues)}
                >
                  {showAllIssues ? 'Show Fewer Issues' : `View All (${integrityIssues.length}) Issues`}
                </button>
              )}
            </div>
            <p style={{ fontSize: '13px', color: '#b91c1c', marginBottom: '14px' }}>
              We found {integrityIssues.length} issue(s) where configuration records require attention. Click any issue card or action button below to resolve it directly.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
              {(showAllIssues ? integrityIssues : integrityIssues.slice(0, 4)).map((issue, i) => (
                <div 
                  key={i} 
                  style={{ 
                    background: '#fff', padding: '12px 14px', borderRadius: '8px', 
                    border: '1px solid #fca5a5', display: 'flex', flexDirection: 'column', 
                    justifyContent: 'space-between', gap: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' 
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ 
                        fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', 
                        background: issue.type === 'error' ? '#fee2e2' : '#fef3c7', 
                        color: issue.type === 'error' ? '#991b1b' : '#92400e' 
                      }}>
                        {issue.category?.toUpperCase() || 'CONFIGURATION'}
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                        ID: {issue.recordId || issue.id}
                      </span>
                    </div>
                    <div style={{ color: '#7f1d1d', fontWeight: 500, fontSize: '12px', lineHeight: 1.45 }}>
                      {issue.message}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ 
                      alignSelf: 'flex-start', fontSize: '12px', fontWeight: 700, color: '#1d4ed8', 
                      background: '#eff6ff', border: '1px solid #bfdbfe', padding: '4px 10px', borderRadius: '6px',
                      display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', transition: 'background 0.15s ease'
                    }}
                    onClick={() => {
                      if (onHandleIntegrityAction) {
                        onHandleIntegrityAction(issue);
                      } else {
                        setActiveTab('settings');
                      }
                    }}
                  >
                    <span>{issue.actionLabel || 'Fix Configuration'}</span>
                    <ChevronRight size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {/* Main KPI Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '24px' }}>
        <KpiCard 
          title="TODAY'S COLLECTIONS" 
          value={todaysCollectionsTotal} 
          prefix="₹" 
          icon={DollarSign} 
          color="#10b981" 
          delay={0.1}
        />
        <KpiCard 
          title="ACTIVE STUDENTS" 
          value={activeStudentsCount} 
          icon={Users} 
          color="#3b82f6" 
          delay={0.2}
          onClick={() => setActiveTab('students')}
        />
        <KpiCard 
          title="SEAT OCCUPANCY" 
          value={seatOccupancyPercent} 
          suffix="%" 
          icon={Grid} 
          color="#8b5cf6" 
          delay={0.3}
          onClick={() => setActiveTab('seats')}
        />
        <KpiCard 
          title="MONTHLY NET PROFIT" 
          value={monthlyNetProfit} 
          prefix="₹" 
          icon={monthlyNetProfit >= 0 ? TrendingUp : TrendingDown} 
          color={monthlyNetProfit >= 0 ? "#10b981" : "#ef4444"} 
          delay={0.4}
          onClick={() => setActiveTab('reports')}
        />
      </div>

      {/* Secondary Grid: Chart & Lists */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>
        
        {/* Chart Section */}
        <motion.div 
          className="premium-card"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.5 }}
        >
          <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Revenue vs Expenses (Last 7 Days)</h3>
          </div>
          <div style={{ height: '300px', width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorExpense" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `₹${value}`} />
                <Tooltip 
                  formatter={(value) => [`₹${Number(value).toLocaleString()}`, undefined]}
                  contentStyle={{ background: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                />
                <Area type="monotone" dataKey="Income" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorIncome)" />
                <Area type="monotone" dataKey="Expense" stroke="#ef4444" strokeWidth={2} fillOpacity={1} fill="url(#colorExpense)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Quick Lists */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* Recent Payments Preview */}
          <div className="premium-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Recent Payments</h3>
              <button className="btn btn-ghost" style={{ fontSize: '12px', padding: '4px 8px' }} onClick={() => setActiveTab('payments')}>
                View All <ChevronRight size={14} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {filteredPayments.slice(0, 4).map(p => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '12px', borderBottom: '1px solid #f1f5f9' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>{p.studentName}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{p.planName} • {p.date}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#10b981' }}>+₹{(p.netTotal || 0).toLocaleString()}</div>
                    <span className="badge badge-active" style={{ fontSize: '10px' }}>{p.method || 'Cash'}</span>
                  </div>
                </div>
              ))}
              {filteredPayments.length === 0 && (
                <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-tertiary)', fontSize: '13px' }}>
                  No payment records yet
                </div>
              )}
            </div>
          </div>

          {/* Expiring Soon Alert Card */}
          <div className="premium-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Clock size={16} color="#f59e0b" /> Expiring Soon
              </h3>
              <span className="badge badge-warning">{expiringSoonCount}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {filteredStudents.filter(s => s.status === 'Expiring Soon').slice(0, 3).map(s => (
                <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '8px', borderBottom: '1px solid #f1f5f9' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>{s.name}</div>
                    <div style={{ fontSize: '11px', color: '#b45309' }}>Expires on {s.expiryDate}</div>
                  </div>
                  <button 
                    type="button" 
                    className="btn btn-ghost" 
                    style={{ fontSize: '11px', color: '#1d4ed8', padding: '2px 8px', border: '1px solid #bfdbfe' }}
                    onClick={() => onTriggerRenew && onTriggerRenew(s)}
                  >
                    Renew
                  </button>
                </div>
              ))}
              {expiringSoonCount === 0 && (
                <div style={{ textAlign: 'center', padding: '16px', color: 'var(--text-tertiary)', fontSize: '13px' }}>
                  No memberships expiring soon
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </motion.div>
  );
};
