import React from 'react';
import { Check } from 'lucide-react';

const inr = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;
const limitLabel = (value) => (value ? Number(value).toLocaleString('en-IN') : 'Unlimited');

export function yearlySavePercent(monthly, yearly) {
  const month = Number(monthly);
  const year = Number(yearly);
  if (!(month > 0) || !(year > 0)) return 0;
  const full = month * 12;
  if (!(year < full)) return 0;
  return Math.round((1 - year / full) * 100);
}

function bestYearlySave(plans) {
  return plans.reduce((best, plan) => Math.max(best, yearlySavePercent(plan.priceMonthly, plan.priceYearly)), 0);
}

function trialPill(plan) {
  const days = Number(plan?.trialDays) || 0;
  if (days <= 0) return null;
  if (plan.trialUsed || plan.trialAlreadyUsed || plan.trialAvailable === false) return 'Pay to start';
  return `${days}-day free trial`;
}

function isPopular(plan) {
  return Boolean(plan?.recommended || plan.mostPopular || plan.popular);
}

function featureLines(plan) {
  const branches = Number(plan.branchLimit) === 1 ? '1 branch' : `${limitLabel(plan.branchLimit)} branches`;
  const lines = [
    `${limitLabel(plan.studentLimit)} students`,
    `${limitLabel(plan.staffLimit)} staff`,
    branches,
  ];
  for (const feature of plan.features || []) {
    const text = String(feature || '').trim();
    if (text) lines.push(text);
  }
  return lines;
}

function priceFor(plan, interval) {
  if (interval === 'year' && Number(plan.priceYearly) > 0) return { amount: plan.priceYearly, suffix: '/year' };
  if (plan.priceMonthly != null) return { amount: plan.priceMonthly, suffix: '/month' };
  if (Number(plan.priceYearly) > 0) return { amount: plan.priceYearly, suffix: '/year' };
  return { amount: 0, suffix: '' };
}

export function SignupPlanPicker({ plans = [], planId, onSelect, interval, onInterval }) {
  if (!plans.length) return null;
  const save = bestYearlySave(plans);
  const yearlyOffered = plans.some(plan => Number(plan.priceYearly) > 0);
  return (
    <fieldset className="signup-plan-picker" style={{ border: 0, padding: 0, margin: '0 0 18px' }}>
      <legend className="form-label" style={{ marginBottom: 8 }}>Choose a plan</legend>
      <div role="group" aria-label="Billing interval" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, padding: 4, borderRadius: 999, background: '#f3f4f6', marginBottom: 12 }}>
        {[['month', 'Monthly'], ['year', 'Yearly']].map(([value, label]) => {
          const selected = interval === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={selected}
              disabled={value === 'year' && !yearlyOffered}
              onClick={() => onInterval(value)}
              style={{
                border: 0, borderRadius: 999, minHeight: 40, cursor: 'pointer', fontWeight: 700, fontSize: 14,
                background: selected ? '#fff' : 'transparent',
                color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
                boxShadow: selected ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              {label}
              {value === 'year' && save > 0 && (
                <span style={{ marginLeft: 6, background: '#dcfce7', color: '#166534', borderRadius: 999, padding: '2px 6px', fontSize: 11 }}>Save {save}%</span>
              )}
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {plans.map(plan => {
          const selected = plan.planId === planId;
          const price = priceFor(plan, interval);
          const pill = trialPill(plan);
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
              {isPopular(plan) && (
                <span style={{ position: 'absolute', top: 10, right: 10, background: '#111827', color: '#fff', borderRadius: 999, fontSize: 11, fontWeight: 700, padding: '3px 8px' }}>Most popular</span>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', paddingRight: isPopular(plan) ? 96 : 28 }}>
                <strong style={{ fontSize: 16 }}>{plan.name}</strong>
                {selected && <Check size={18} color="var(--brand-accent, #2563eb)" aria-label="Selected" />}
              </div>
              <div style={{ marginTop: 6, fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.1 }}>
                {inr(price.amount)}
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>{price.suffix}</span>
              </div>
              {pill && (
                <span style={{ display: 'inline-block', marginTop: 8, background: pill === 'Pay to start' ? '#ffedd5' : '#dbeafe', color: pill === 'Pay to start' ? '#9a3412' : '#1d4ed8', borderRadius: 999, fontSize: 12, fontWeight: 700, padding: '4px 10px' }}>{pill}</span>
              )}
              <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {featureLines(plan).map(line => (
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
