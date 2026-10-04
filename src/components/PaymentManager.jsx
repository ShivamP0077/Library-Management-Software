import React, { useState, useMemo } from 'react';
import { useLibrary } from '../context/LibraryContext';
import { CreditCard, Printer, Search, DollarSign, Calendar, UserCheck, Filter } from 'lucide-react';
import { motion } from 'framer-motion';

export const PaymentManager = ({ onPrintReceipt }) => {
  const { payments, branches, activeBranchId } = useLibrary();
  const [searchQuery, setSearchQuery] = useState('');
  const [methodFilter, setMethodFilter] = useState('All');
  const [staffFilter, setStaffFilter] = useState('All');
  const [datePreset, setDatePreset] = useState('All Dates');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  const uniqueStaff = useMemo(() => {
    return Array.from(new Set(payments.map(p => p.staffName).filter(Boolean)));
  }, [payments]);

  // Helper to extract effective portion for a specific method (solves Problem 13 & 20)
  const getEffectivePortion = (payment, method) => {
    if (method === 'All') return Number(payment.netTotal || 0);
    if (method === 'Split') {
      return payment.method === 'Split' ? Number(payment.netTotal || 0) : 0;
    }
    if (payment.method === method) {
      return Number(payment.netTotal || 0);
    }
    if (payment.method === 'Split' && Array.isArray(payment.breakdown)) {
      const portion = payment.breakdown.find(b => b.method === method);
      return portion ? Number(portion.amount || 0) : 0;
    }
    return 0;
  };

  // Safe Date Filtering Helper using presets and timestamps
  const isWithinDatePreset = (dateStr, preset, startStr, endStr) => {
    if (preset === 'All Dates' || !preset) return true;
    if (!dateStr) return false;

    const itemDate = new Date(dateStr);
    if (isNaN(itemDate.getTime())) return true;

    const now = new Date();
    const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

    if (preset === 'Today') {
      return itemDate >= startOfDay(now) && itemDate <= endOfDay(now);
    }
    if (preset === 'This Week') {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(now);
      monday.setDate(diff);
      return itemDate >= startOfDay(monday) && itemDate <= endOfDay(now);
    }
    if (preset === 'This Month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      return itemDate >= startOfDay(firstDay) && itemDate <= endOfDay(now);
    }
    if (preset === 'Last 3 Months') {
      const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
      return itemDate >= startOfDay(threeMonthsAgo) && itemDate <= endOfDay(now);
    }
    if (preset === 'Last 6 Months') {
      const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
      return itemDate >= startOfDay(sixMonthsAgo) && itemDate <= endOfDay(now);
    }
    if (preset === 'This Year') {
      const firstDayYear = new Date(now.getFullYear(), 0, 1);
      return itemDate >= startOfDay(firstDayYear) && itemDate <= endOfDay(now);
    }
    if (preset === 'Custom Date Range') {
      if (startStr && itemDate < startOfDay(new Date(startStr))) return false;
      if (endStr && itemDate > endOfDay(new Date(endStr))) return false;
      return true;
    }
    return true;
  };

  const filteredPayments = useMemo(() => {
    return payments.filter(p => {
      if (activeBranchId !== 'all' && p.branchId !== activeBranchId) return false;

      // Portion-aware method filtering: if specific method, must have portion > 0
      if (methodFilter !== 'All') {
        const portion = getEffectivePortion(p, methodFilter);
        if (portion <= 0) return false;
      }

      if (staffFilter !== 'All' && p.staffName !== staffFilter) return false;

      if (!isWithinDatePreset(p.date, datePreset, customStartDate, customEndDate)) return false;

      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          (p.receiptNo && p.receiptNo.toLowerCase().includes(q)) ||
          (p.studentName && p.studentName.toLowerCase().includes(q)) ||
          (p.studentId && p.studentId.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [payments, activeBranchId, methodFilter, staffFilter, datePreset, customStartDate, customEndDate, searchQuery]);

  const getBranchCode = (bId) => branches.find(branch => branch.id === bId)?.name || bId;

  // Portion-level collection aggregation without double counting (Problem 13 & 20)
  const totalCollectedAmount = useMemo(() => {
    return filteredPayments.reduce((sum, p) => sum + getEffectivePortion(p, methodFilter), 0);
  }, [filteredPayments, methodFilter]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* Header Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Fee Collections & Ledger</h2>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Track payments, split portions, and generate receipts</p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ background: '#dcfce7', border: '1px solid #bbf7d0', padding: '8px 16px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <DollarSign size={20} color="#16a34a" />
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#15803d', letterSpacing: '0.05em' }}>
                {methodFilter === 'All' ? 'TOTAL COLLECTIONS' : `TOTAL (${methodFilter.toUpperCase()})`}
              </div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#16a34a' }}>₹{totalCollectedAmount.toLocaleString()}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="premium-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          
          {/* Search Box */}
          <div style={{ flex: 1, minWidth: '220px', position: 'relative' }}>
            <Search size={16} color="var(--text-tertiary)" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="text" className="form-input"
              placeholder="Search Receipt No, Name, or ID..."
              value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingLeft: '36px' }}
            />
          </div>

          {/* Payment Method Filter */}
          <div style={{ minWidth: '160px' }}>
            <select className="form-select" value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)}>
              <option value="All">All Payment Modes</option>
              <option value="UPI">UPI / QR Code</option>
              <option value="Cash">Cash</option>
              <option value="Card">Debit / Credit Card</option>
              <option value="Bank Transfer">Bank Transfer</option>
              <option value="Split">Split Payment</option>
            </select>
          </div>

          {/* Staff Filter */}
          <div style={{ minWidth: '150px' }}>
            <select className="form-select" value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)}>
              <option value="All">All Staff</option>
              {uniqueStaff.map(staff => <option key={staff} value={staff}>{staff}</option>)}
            </select>
          </div>

          {/* Date Range Preset Filter */}
          <div style={{ minWidth: '160px' }}>
            <select className="form-select" value={datePreset} onChange={(e) => setDatePreset(e.target.value)}>
              <option value="All Dates">All Dates</option>
              <option value="Today">Today</option>
              <option value="This Week">This Week</option>
              <option value="This Month">This Month</option>
              <option value="Last 3 Months">Last 3 Months</option>
              <option value="Last 6 Months">Last 6 Months</option>
              <option value="This Year">This Year</option>
              <option value="Custom Date Range">Custom Date Range</option>
            </select>
          </div>
        </div>

        {/* Custom Date Range Picker (shown when Custom Date Range is selected) */}
        {datePreset === 'Custom Date Range' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', paddingTop: '8px', borderTop: '1px solid var(--border-light)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>From:</span>
              <input
                type="date"
                className="form-input"
                style={{ padding: '6px 10px', fontSize: '13px' }}
                value={customStartDate}
                onChange={e => setCustomStartDate(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>To:</span>
              <input
                type="date"
                className="form-input"
                style={{ padding: '6px 10px', fontSize: '13px' }}
                value={customEndDate}
                onChange={e => setCustomEndDate(e.target.value)}
              />
            </div>
            {(customStartDate || customEndDate) && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => { setCustomStartDate(''); setCustomEndDate(''); }}
              >
                Clear Dates
              </button>
            )}
          </div>
        )}
      </div>

      {/* Ledger Table */}
      <div className="table-container">
        <table className="data-grid">
          <thead>
            <tr>
              <th>RECEIPT</th>
              <th>STUDENT</th>
              <th>BRANCH</th>
              <th>PLAN</th>
              <th>MODE</th>
              <th>DATE</th>
              <th>AMOUNT</th>
              <th style={{ textAlign: 'right' }}>ACTION</th>
            </tr>
          </thead>
          <tbody>
            {filteredPayments.length === 0 ? (
              <tr>
                <td colSpan="8" style={{ textAlign: 'center', padding: '48px', color: 'var(--text-tertiary)' }}>
                  No payment transactions matching your filter criteria.
                </td>
              </tr>
            ) : (
              filteredPayments.map(pay => {
                const effectivePortion = getEffectivePortion(pay, methodFilter);
                const isPortionDifferent = methodFilter !== 'All' && methodFilter !== 'Split' && pay.method === 'Split';

                return (
                  <tr key={pay.receiptNo}>
                    <td>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '13px' }}>{pay.receiptNo}</span>
                      {pay.staffName && (
                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>By: {pay.staffName}</div>
                      )}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{pay.studentName}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{pay.studentId}</div>
                    </td>
                    <td>
                      <span style={{ fontSize: '13px', fontWeight: 500 }}>
                        {pay.branchName || getBranchCode(pay.branchId)}
                      </span>
                    </td>
                    <td><span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{pay.planName}</span></td>
                    <td>
                      {pay.method === 'Split' && pay.breakdown ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ background: '#f3f4f6', padding: '3px 8px', borderRadius: '4px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '12px', display: 'inline-block', width: 'fit-content' }}>
                            Split Payment
                          </span>
                          {pay.breakdown.map((b, idx) => (
                            <span
                              key={idx}
                              style={{
                                fontSize: '11px',
                                fontWeight: b.method === methodFilter ? 700 : 400,
                                color: b.method === methodFilter ? '#15803d' : 'var(--text-tertiary)'
                              }}
                            >
                              {b.method}: ₹{b.amount}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span style={{ background: '#f3f4f6', padding: '4px 8px', borderRadius: '4px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '12px' }}>
                          {pay.method}
                        </span>
                      )}
                    </td>
                    <td><span style={{ fontSize: '13px' }}>{pay.date}</span></td>
                    <td>
                      <div style={{ fontWeight: 700, color: '#10b981', fontSize: '14px' }}>
                        ₹{effectivePortion.toLocaleString()}
                      </div>
                      {isPortionDifferent && (
                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                          Total: ₹{pay.netTotal.toLocaleString()}
                        </div>
                      )}
                      {(pay.discount > 0 || pay.fine > 0) && (
                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                          Disc: ₹{pay.discount} | Fine: ₹{pay.fine}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-ghost" style={{ padding: '6px 12px' }} onClick={() => onPrintReceipt(pay)}>
                        <Printer size={14} /> Print
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
};
