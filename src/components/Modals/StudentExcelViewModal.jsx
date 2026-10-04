import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { X, Search, Download, ArrowUpDown, ArrowUp, ArrowDown, Activity, Clock, ChevronDown } from 'lucide-react';
import { useLibrary } from '../../context/LibraryContext';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import toast from 'react-hot-toast';

export const StudentExcelViewModal = ({ isOpen, onClose, studentsData, title = "Student Records" }) => {
  const { branches, settings, shifts, setStudents } = useLibrary();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [shiftFilter, setShiftFilter] = useState('All');
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  
  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const filteredStudents = useMemo(() => {
    return studentsData.filter(s => {
      const q = searchTerm.toLowerCase().trim();
      const normalizeSeat = (seat) => {
        if (!seat) return '';
        const match = String(seat).match(/^([a-zA-Z]+)\s*-?\s*0*(\d+)$/);
        return match ? `${match[1].toLowerCase()}-${match[2]}` : String(seat).toLowerCase().replace(/\s+/g, '');
      };
      const normQ = normalizeSeat(q);
      const normSeat = normalizeSeat(s.seatNo);
      const matchesSeat = normSeat.startsWith(normQ);
      
      const isShortSeatPrefix = /^[a-z]{1,2}\s*-?\s*\d{1,2}$/.test(q);
      const matchesId = isShortSeatPrefix ? false : s.id.toLowerCase().includes(q);
      
      const matchesSearch = !q || s.name.toLowerCase().includes(q) || matchesId || s.phone.includes(q) || matchesSeat;
      
      const status = s.status;
      
      const matchesStatus = statusFilter === 'All' || status === statusFilter;
      const matchesShift = shiftFilter === 'All' || s.shift === shiftFilter;

      return matchesSearch && matchesStatus && matchesShift;
    });
  }, [studentsData, searchTerm, statusFilter, shiftFilter]);

  const sortedStudents = useMemo(() => {
    let sortableItems = [...filteredStudents];
    if (sortConfig.key !== null) {
      sortableItems.sort((a, b) => {
        let aValue = a[sortConfig.key];
        let bValue = b[sortConfig.key];

        if (sortConfig.key === 'branchId') {
           aValue = branches.find(branch => branch.id === a.branchId)?.name || '';
           bValue = branches.find(branch => branch.id === b.branchId)?.name || '';
        }

        if (aValue < bValue) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (aValue > bValue) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableItems;
  }, [filteredStudents, sortConfig, branches]);

  const requestSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const getSortIcon = (key) => {
    if (sortConfig.key !== key) return <ArrowUpDown size={14} style={{ opacity: 0.3, marginLeft: '4px' }} />;
    return sortConfig.direction === 'asc' ? <ArrowUp size={14} style={{ marginLeft: '4px' }} /> : <ArrowDown size={14} style={{ marginLeft: '4px' }} />;
  };

  const handleDownloadPDF = () => {
    try {
      const doc = new jsPDF('landscape');
      
      // Header
      doc.setFontSize(20);
      doc.setTextColor(33, 33, 33);
      doc.text(settings?.libraryName || "Library Management System", 14, 22);
      
      doc.setFontSize(14);
      doc.setTextColor(100, 100, 100);
      doc.text(title, 14, 32);
      
      doc.setFontSize(10);
      doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 40);
      doc.text(`Total Records: ${sortedStudents.length}`, 14, 46);

      const tableColumn = ["ID", "Name", "Phone", "Branch", "Seat", "Shift", "Start Date", "Expiry Date", "Status"];
      const tableRows = [];

      sortedStudents.forEach(student => {
        const branchName = branches.find(b => b.id === student.branchId)?.name || 'Unknown';
        const status = student.status;
        
        const studentData = [
          student.id,
          student.name,
          student.phone,
          branchName,
          student.seatNo,
          student.shift,
          student.startDate,
          student.expiryDate,
          status
        ];
        tableRows.push(studentData);
      });

      autoTable(doc, {
        head: [tableColumn],
        body: tableRows,
        startY: 55,
        theme: 'striped',
        styles: { fontSize: 9, cellPadding: 3 },
        headStyles: { fillColor: [41, 128, 185], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 245, 245] },
        margin: { top: 55 }
      });

      doc.save(`Library_Report_${new Date().toISOString().split('T')[0]}.pdf`);
      toast.success('PDF downloaded successfully');
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast.error('Failed to generate PDF');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" style={{ padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <motion.div 
        className="modal-content"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        style={{ 
          maxWidth: '95vw', 
          width: '100%',
          maxHeight: '95vh',
          display: 'flex', 
          flexDirection: 'column',
          margin: '0 auto',
          overflow: 'hidden'
        }}
      >
        <div className="modal-header" style={{ padding: '24px', borderBottom: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <h3 style={{ fontSize: '24px', fontWeight: 700, color: '#111827' }}>Spreadsheet View - {title}</h3>
          </div>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: '#6B7280' }} onClick={onClose} title="Close">
            <X size={24} />
          </button>
        </div>

        <div className="modal-body" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden' }}>
          
          {/* Controls */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', padding: '0 24px 24px 24px' }}>
            {/* Left: Search */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, minWidth: '300px' }}>
              <div style={{ display: 'flex', alignItems: 'center', background: '#fff', border: '1px solid #E5E7EB', borderRadius: '8px', padding: '10px 16px' }}>
                <Search size={20} color="#9CA3AF" style={{ marginRight: '12px' }} />
                <input 
                  type="text" 
                  placeholder="Type to search students..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={{ border: 'none', outline: 'none', width: '100%', fontSize: '15px', color: '#111827', background: 'transparent' }}
                />
              </div>
              <span style={{ fontSize: '12px', color: '#9CA3AF', paddingLeft: '4px' }}>Search by ID, name, phone, branch, seat, shift, status...</span>
            </div>

            {/* Right: Filters & Action */}
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
              
              {/* Status Filter */}
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', background: '#fff', border: '1px solid #E5E7EB', borderRadius: '8px', padding: '8px 16px', gap: '12px', minWidth: '160px' }}>
                <div style={{ color: '#10B981', pointerEvents: 'none' }}>
                  <Activity size={20} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, pointerEvents: 'none' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#374151' }}>Status</span>
                  <span style={{ fontSize: '14px', color: '#111827' }}>
                    {statusFilter === 'All' ? 'All Status' : statusFilter}
                  </span>
                </div>
                <ChevronDown size={16} color="#6B7280" style={{ pointerEvents: 'none' }} />
                <select 
                  value={statusFilter} 
                  onChange={(e) => setStatusFilter(e.target.value)}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', appearance: 'none' }}
                >
                  <option value="All">All Status</option>
                  <option value="Active">Active</option>
                  <option value="Expired">Expired</option>
                </select>
              </div>

              {/* Shift Filter */}
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', background: '#fff', border: '1px solid #E5E7EB', borderRadius: '8px', padding: '8px 16px', gap: '12px', minWidth: '160px' }}>
                <div style={{ color: '#6366F1', pointerEvents: 'none' }}>
                  <Clock size={20} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, pointerEvents: 'none' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#374151' }}>Shift</span>
                  <span style={{ fontSize: '14px', color: '#111827' }}>
                    {shiftFilter === 'All' ? 'All Shifts' : shiftFilter}
                  </span>
                </div>
                <ChevronDown size={16} color="#6B7280" style={{ pointerEvents: 'none' }} />
                <select 
                  value={shiftFilter} 
                  onChange={(e) => setShiftFilter(e.target.value)}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', appearance: 'none' }}
                >
                  <option value="All">All Shifts</option>
                  {shifts.map(s => (
                    <option key={s.id} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </div>

              {/* Download Button */}
              <button 
                onClick={handleDownloadPDF}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#111827', color: '#fff', border: 'none', borderRadius: '8px', padding: '12px 20px', fontSize: '14px', fontWeight: 500, cursor: 'pointer', height: '46px' }}
              >
                <Download size={18} />
                Download PDF
              </button>
            </div>
          </div>

          {/* Spreadsheet Table */}
          <div style={{ 
            flex: 1, 
            overflow: 'auto', 
            background: '#fff'
          }}>
            <table style={{ width: '100%', minWidth: '1000px', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: '#F9FAFB' }}>
                <tr>
                  {['id', 'name', 'phone', 'branchId', 'seatNo', 'shift', 'startDate', 'expiryDate', 'status'].map((key) => {
                    const labels = {
                      id: 'ID', name: 'Name', phone: 'Phone', branchId: 'Branch',
                      seatNo: 'Seat', shift: 'Shift', startDate: 'Start Date',
                      expiryDate: 'Expiry Date', status: 'Status'
                    };
                    return (
                      <th 
                        key={key} 
                        onClick={() => requestSort(key)} 
                        style={{ cursor: 'pointer', userSelect: 'none', padding: '16px 24px', fontSize: '13px', fontWeight: 600, color: '#374151', borderBottom: '1px solid #E5E7EB', whiteSpace: 'nowrap', textAlign: 'left' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                          {labels[key]} 
                          {getSortIcon(key)}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedStudents.map(student => {
                  const branchName = branches.find(b => b.id === student.branchId)?.name || 'Unknown';
                  
                  return (
                    <tr key={student.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                      <td style={{ padding: '16px 24px', color: '#6B7280', fontSize: '14px', whiteSpace: 'nowrap' }}>{student.id}</td>
                      <td style={{ padding: '16px 24px', color: '#111827', fontSize: '14px', whiteSpace: 'nowrap' }}>{student.name}</td>
                      <td style={{ padding: '16px 24px', color: '#4B5563', fontSize: '14px', whiteSpace: 'nowrap' }}>{student.phone}</td>
                      <td style={{ padding: '16px 24px', color: '#4B5563', fontSize: '14px', maxWidth: '150px', whiteSpace: 'normal' }}>{branchName}</td>
                      <td style={{ padding: '16px 24px', color: '#4B5563', fontSize: '14px', whiteSpace: 'nowrap' }}>{student.seatNo}</td>
                      <td style={{ padding: '16px 24px', color: '#4B5563', fontSize: '14px', whiteSpace: 'nowrap' }}>{student.shift}</td>
                      <td style={{ padding: '16px 24px', color: '#4B5563', fontSize: '14px', whiteSpace: 'nowrap' }}>{student.startDate}</td>
                      <td style={{ padding: '16px 24px', color: '#4B5563', fontSize: '14px', whiteSpace: 'nowrap' }}>{student.expiryDate}</td>
                      <td style={{ padding: '16px 24px' }}>
                        <div style={{ position: 'relative', display: 'inline-block' }}>
                          <select 
                            style={{ 
                              appearance: 'none',
                              background: student.status === 'Active' || student.status === 'Expiring Soon' ? '#D1FAE5' : '#FEE2E2',
                              color: student.status === 'Active' || student.status === 'Expiring Soon' ? '#059669' : '#DC2626',
                              padding: '6px 30px 6px 12px',
                              borderRadius: '100px',
                              fontSize: '13px',
                              fontWeight: 500,
                              border: 'none',
                              outline: 'none',
                              cursor: 'pointer'
                            }}
                            value={student.status === 'Expiring Soon' ? 'Active' : student.status}
                            onChange={(e) => {
                              const newStatus = e.target.value;
                              if (setStudents) {
                                setStudents(prev => prev.map(s => s.id === student.id ? { ...s, status: newStatus } : s));
                                toast.success(`${student.name}'s status updated to ${newStatus}`);
                              }
                            }}
                          >
                            <option value="Active">Active</option>
                            <option value="Expired">Expired</option>
                          </select>
                          <ChevronDown size={14} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: student.status === 'Active' || student.status === 'Expiring Soon' ? '#059669' : '#DC2626', opacity: 0.5 }} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {sortedStudents.length === 0 && (
                  <tr>
                    <td colSpan="9" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                      No records found matching your filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

        </div>
      </motion.div>
    </div>
  );
};
