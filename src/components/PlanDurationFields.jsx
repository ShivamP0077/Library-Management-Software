import React from 'react';
import { NumericInput } from './NumericInput';
import { CYCLE_MODES, CYCLE_MODE_LABELS } from '../utils/billingCycle';

const HINTS = {
  ANNIVERSARY: 'Joined 15 Feb → due 15 Mar (coverage 15 Feb–14 Mar).',
  CALENDAR_MONTH: 'Billed on a fixed day of each calendar month. New joiners can pay the remaining days.',
  N_DAYS: 'A fixed number of days, for example 30. Joining mid-cycle can pay the remaining days.',
  YEARLY: 'One library year. Joining mid-year can pay the remaining days.',
};

/** Duration type for one fee plan. Same four modes and extra fields as library billing settings. */
export function PlanDurationFields({ value, onChange }) {
  const mode = CYCLE_MODES.includes(value?.mode) ? value.mode : 'ANNIVERSARY';
  const set = (patch) => onChange({ ...value, mode, ...patch });
  return (
    <div>
      <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>Duration type</label>
      <select
        className="form-select"
        aria-label="Duration type"
        value={mode}
        onChange={e => set({ mode: e.target.value })}
      >
        {CYCLE_MODES.map(m => (
          <option key={m} value={m}>{CYCLE_MODE_LABELS[m]}</option>
        ))}
      </select>
      <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>{HINTS[mode]}</span>
      {mode === 'CALENDAR_MONTH' && (
        <div className="form-group" style={{ marginTop: '10px', marginBottom: 0 }}>
          <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>Calendar billing day (1–28)</label>
          <NumericInput
            className="form-input"
            aria-label="Calendar billing day"
            value={value?.calendarBillingDay ?? 1}
            onChange={e => set({ calendarBillingDay: Math.min(28, Math.max(1, Number(e.target.value) || 1)) })}
          />
        </div>
      )}
      {(mode === 'N_DAYS' || mode === 'YEARLY') && (
        <div className="form-group" style={{ marginTop: '10px', marginBottom: 0 }}>
          <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>Cycle start date</label>
          <input
            type="date"
            className="form-input"
            aria-label="Cycle start date"
            value={value?.cycleAnchorDate || ''}
            onChange={e => set({ cycleAnchorDate: e.target.value })}
          />
        </div>
      )}
      {mode === 'N_DAYS' && (
        <div className="form-group" style={{ marginTop: '10px', marginBottom: 0 }}>
          <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>Cycle length (days)</label>
          <NumericInput
            className="form-input"
            aria-label="Cycle length in days"
            value={value?.cycleDays ?? 30}
            onChange={e => set({ cycleDays: Number(e.target.value) || 0 })}
          />
        </div>
      )}
    </div>
  );
}
