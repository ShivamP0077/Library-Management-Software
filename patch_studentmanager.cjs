const fs = require('fs');
const path = require('path');

let content = fs.readFileSync(path.join(__dirname, 'scratch_studentmanager.jsx'), 'utf8');

// 1. Add viewMode state
content = content.replace(
  "const [activeDrawerTab, setActiveDrawerTab] = useState('renewals');",
  "const [activeDrawerTab, setActiveDrawerTab] = useState('renewals');\n  const [viewMode, setViewMode] = useState('active'); // active | waiting"
);

// 2. Add waitingList and removeFromWaitingList to useLibrary
content = content.replace(
  "const { students, branches, activeBranchId, plans, shifts, seatTypes, renewSubscription, changeSeat, archiveStudent, cancelAdmission, cancelRenewalTransaction, getValidDesksList, getAvailableEligibleSeats, currentStaff } = useLibrary();",
  "const { students, branches, activeBranchId, plans, shifts, seatTypes, renewSubscription, changeSeat, archiveStudent, cancelAdmission, cancelRenewalTransaction, getValidDesksList, getAvailableEligibleSeats, currentStaff, waitingList, removeFromWaitingList } = useLibrary();"
);

// 3. Add toggle buttons
content = content.replace(
  "<div>\n          <h2 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Student Records</h2>\n          <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Manage enrollments, seating, and renewals</p>\n        </div>",
  `<div>
          <h2 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Student Records</h2>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Manage enrollments, seating, and renewals</p>
        </div>
        
        <div style={{ display: 'flex', background: '#e2e8f0', borderRadius: '8px', padding: '4px', margin: '0 16px' }}>
          <button className={\`btn \${viewMode === 'active' ? 'btn-primary' : 'btn-ghost'}\`} onClick={() => setViewMode('active')} style={{ padding: '6px 16px' }}>Active Students</button>
          <button className={\`btn \${viewMode === 'waiting' ? 'btn-primary' : 'btn-ghost'}\`} onClick={() => setViewMode('waiting')} style={{ padding: '6px 16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            Waiting List
            {waitingList.length > 0 && <span style={{ background: viewMode === 'waiting' ? '#fff' : 'var(--brand-primary)', color: viewMode === 'waiting' ? 'var(--brand-primary)' : '#fff', borderRadius: '12px', padding: '2px 6px', fontSize: '10px', fontWeight: 700 }}>{waitingList.length}</span>}
          </button>
        </div>`
);

// 4. Create the Waiting List view
const waitingListViewCode = `

      {/* Waiting List View */}
      {viewMode === 'waiting' && (
        <div className="premium-card" style={{ padding: '16px' }}>
           <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
             <Clock size={20} /> Waiting List & Vacancy Matcher
           </h3>
           
           {waitingList.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-tertiary)' }}>
                No students currently in the waiting list.
              </div>
           ) : (
              <table className="data-grid">
                <thead>
                  <tr>
                    <th>PRIORITY</th>
                    <th>STUDENT</th>
                    <th>PREFERENCES</th>
                    <th>VACANCY MATCH</th>
                    <th style={{ textAlign: 'right' }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {waitingList.sort((a,b) => a.priority - b.priority).map((wl) => {
                    const st = seatTypes.find(s => s.id === wl.seatTypeId);
                    const sh = shifts.find(s => s.id === wl.shiftId);
                    
                    const availableSeats = getAvailableEligibleSeats(wl.libraryId, wl.branchId, wl.sectionId, wl.seatTypeId, wl.shiftId);
                    const isMatch = availableSeats.length > 0;
                    
                    return (
                      <tr key={wl.studentId}>
                        <td>
                           <span style={{ background: '#f3f4f6', padding: '4px 8px', borderRadius: '4px', fontWeight: 600 }}>#{wl.priority}</span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{wl.name}</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{wl.phone}</div>
                        </td>
                        <td>
                          <div style={{ fontSize: '13px' }}>{st?.name || 'Any Seat'}</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{sh?.name || 'Any Shift'}</div>
                        </td>
                        <td>
                           {isMatch ? (
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#ecfdf5', color: '#059669', padding: '4px 10px', borderRadius: '16px', fontSize: '12px', fontWeight: 600 }}>
                                <CheckCircle size={14} /> Vacancy Available ({availableSeats.length})
                              </div>
                           ) : (
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#fef2f2', color: '#dc2626', padding: '4px 10px', borderRadius: '16px', fontSize: '12px', fontWeight: 600 }}>
                                <AlertCircle size={14} /> No Vacancy
                              </div>
                           )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {isMatch && (
                             <button className="btn btn-primary" style={{ padding: '6px 12px', marginRight: '8px' }} onClick={() => {
                               toast.success('Please fill the admission form for this student to complete admission.');
                               onOpenNewStudent();
                             }}>
                               Admit Now
                             </button>
                          )}
                          <button className="btn btn-ghost" style={{ padding: '6px 12px', color: '#ef4444' }} onClick={() => {
                            if (window.confirm(\`Remove \${wl.name} from waiting list?\`)) {
                              removeFromWaitingList(wl.studentId);
                            }
                          }}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
           )}
        </div>
      )}
`;

// 5. Hide filters & active grid when in waiting mode
content = content.replace(
  "{/* Filters Toolbar */}",
  "{viewMode === 'active' && (\n      <>\n      {/* Filters Toolbar */}"
);

content = content.replace(
  "      {/* Profile Modal */}",
  "      </>\n      )}\n" + waitingListViewCode + "\n\n      {/* Profile Modal */}"
);

fs.writeFileSync(path.join(__dirname, 'src/components/StudentManager.jsx'), content, 'utf8');
console.log('StudentManager patched successfully!');
