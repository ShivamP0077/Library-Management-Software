import React from 'react';
import { Check } from 'lucide-react';
import { DURATION_ROWS, intervalOffered } from '../utils/softwarePlanForm';

const inrMinor = (minor) => `₹${(Number(minor || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function trialPill(plan) {
  const days = Number(plan?.trialDays) || 0;
  if (days <= 0) return null;
  if (plan.trialUsed || plan.trialAlreadyUsed || plan.trialAvailable === false) return 'Pay to start';
  return `${days}-day free trial`;
}

function priceFor(plan, interval) {
  const row = (plan.intervals || []).find(item => item.interval === interval && item.available);
  if (row) return row;
  if (interval === 'month' && plan.priceMonthly != null) return { finalMinor: Math.round(Number(plan.priceMonthly) * 100), originalMinor: Math.round(Number(plan.priceMonthly) * 100), savingMinor: 0 };
  if (interval === 'year' && Number(plan.priceYearly) > 0) return { finalMinor: Math.round(Number(plan.priceYearly) * 100), originalMinor: Math.round(Number(plan.priceMonthly || 0) * 12 * 100), savingMinor: 0 };
  return null;
}

export function SignupPlanPicker({ plans = [], planId, onSelect, interval, onInterval }) {
  if (!plans.length) return null;
  const offered = (value) => plans.some(plan => intervalOffered(plan, value));
  return (
    <fieldset className="signup-plan-picker" style={{ border: 0, padding: 0, margin: '0 0 18px' }}>
      <legend className="form-label" style={{ marginBottom: 8 }}>Choose a plan</legend>
      <div role="group" aria-label="Billing duration" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, padding: 4, borderRadius: 999, background: '#f3f4f6', marginBottom: 12 }}>
        {DURATION_ROWS.map(([value, label]) => {
          const selected = interval === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={selected}
              disabled={!offered(value)}
              onClick={() => onInterval(value)}
              style={{
                border: 0, borderRadius: 999, minHeight: 40, cursor: 'pointer', fontWeight: 700, fontSize: 13,
                background: selected ? '#fff' : 'transparent',
                color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
                boxShadow: selected ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {plans.map(plan => {
          const selected = plan.planId === planId;
          const price = priceFor(plan, interval);
          const pill = trialPill(plan);
          const lines = plan.highlights?.length ? plan.highlights : [];
          return (
            <button
              key={plan.planId}
              type="button"
              data-signup-plan={plan.planId}
              aria-pressed={selected}
              onClick={() => onSelect(plan.planId)}
              style={{
                position: 'relative', textAlign: 'left', width: '100%', cursor: 'pointer',
                borderRadius: 14, padding: 14, background: '#fff',
                border: selected ? '2px solid var(--brand-accent, #2563eb)' : '1px solid var(--border-strong, #e5e7eb)',
                boxShadow: selected ? '0 0 0 3px rgba(37, 99, 235, 0.15)' : 'none',
              }}
            >
              {plan.recommended && (
                <span style={{ position: 'absolute', top: 10, right: 10, background: '#111827', color: '#fff', borderRadius: 999, fontSize: 11, fontWeight: 700, padding: '3px 8px' }}>Recommended</span>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', paddingRight: plan.recommended ? 110 : 28 }}>
                <strong style={{ fontSize: 16 }}>{plan.name}</strong>
                {selected && <Check size={18} color="var(--brand-accent, #2563eb)" aria-label="Selected" />}
              </div>
              {price ? (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.1 }}>{inrMinor(price.finalMinor)}</div>
                  {price.savingMinor > 0 && (
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                      <span style={{ textDecoration: 'line-through' }}>{inrMinor(price.originalMinor)}</span>
                      {' '}Save {inrMinor(price.savingMinor)}
                    </div>
                  )}
                </div>
              ) : <div style={{ marginTop: 6, fontSize: 13, color: 'var(--text-secondary)' }}>Not offered for this duration</div>}
              {pill && (
                <span style={{ display: 'inline-block', marginTop: 8, background: pill === 'Pay to start' ? '#ffedd5' : '#dbeafe', color: pill === 'Pay to start' ? '#9a3412' : '#1d4ed8', borderRadius: 999, fontSize: 12, fontWeight: 700, padding: '4px 10px' }}>{pill}</span>
              )}
              <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {lines.map(line => (
                  <li key={line} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: 'var(--text-secondary)' }}>
                    <Check size={14} color="#16a34a" style={{ marginTop: 2, flexShrink: 0 }} />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
