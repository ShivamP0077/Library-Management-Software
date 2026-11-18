import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { NumericInput } from './NumericInput';
import {
  compileDurationPricing,
  defaultCountsForUnit,
  defaultDiscountFor,
  describePricingControl,
  formatDurationLabel,
  tierCount,
  tierUnit,
} from '../utils/pricingCalculator';

/**
 * Common unit price and duration tabs for Setup Wizard and Library Settings.
 * Cycle mode chooses the unit: month, day, or year.
 */
export function PlanPricingFields({ cycleMode, unitPrice, durationPricing, onChange }) {
  const view = describePricingControl(cycleMode);
  const unit = view.unit;
  const [customCount, setCustomCount] = useState('');

  const rows = (Array.isArray(durationPricing) ? durationPricing : [])
    .filter(row => tierUnit(row) === unit && tierCount(row) > 0)
    .sort((a, b) => tierCount(a) - tierCount(b));

  const emit = (price, tiers) => {
    const safe = Number(price) || 0;
    const patch = {
      unitPrice: safe,
      durationPricing: compileDurationPricing(safe, tiers, unit),
    };
    if (unit === 'month') patch.monthlyPrice = safe;
    onChange(patch);
  };

  const tiersFromRows = (list) => list.map(row => ({
    count: tierCount(row),
    discountType: row.discountType === 'Percentage' || row.discountType === 'Fixed' ? row.discountType : 'None',
    discountValue: Number(row.discountValue) || 0,
  }));

  const togglePreset = (count) => {
    const active = rows.some(row => tierCount(row) === count);
    const tiers = active
      ? tiersFromRows(rows.filter(row => tierCount(row) !== count))
      : [...tiersFromRows(rows), { count, ...defaultDiscountFor(unit, count) }];
    emit(unitPrice, tiers);
  };

  const addCustom = () => {
    const count = Math.round(Number(customCount));
    if (!Number.isFinite(count) || count <= 0) return;
    if (rows.some(row => tierCount(row) === count)) {
      setCustomCount('');
      return;
    }
    emit(unitPrice, [...tiersFromRows(rows), { count, ...defaultDiscountFor(unit, count) }]);
    setCustomCount('');
  };

  const presets = defaultCountsForUnit(unit);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
        <label className="form-label" style={{ fontSize: '12px', fontWeight: 600, margin: 0 }}>Pricing & Discounts per Duration</label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
          {view.priceLabel}
          <NumericInput
            className="form-input"
            aria-label={view.priceLabel}
            style={{ width: '120px', padding: '4px 8px', fontSize: '12px' }}
            value={unitPrice}
            onChange={e => emit(Number(e.target.value) || 0, tiersFromRows(rows))}
          />
        </label>
      </div>

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
        {presets.map(count => {
          const active = rows.some(row => tierCount(row) === count);
          const row = rows.find(item => tierCount(item) === count);
          const discount = row && row.discountType === 'Percentage' ? Number(row.discountValue) : 0;
          const label = formatDurationLabel(count, unit);
          return (
            <button
              type="button"
              key={count}
              aria-pressed={active}
              aria-label={label}
              className={active ? 'btn btn-primary' : 'btn btn-ghost'}
              style={{ fontSize: '11px', padding: '3px 10px', border: active ? '1px solid transparent' : '1px solid var(--border-light)' }}
              onClick={() => togglePreset(count)}
            >
              {active ? label : `+ ${label}`}{active && discount > 0 ? ` · ${discount}% off` : ''}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {rows.map(row => {
          const count = tierCount(row);
          const base = Number(row.basePrice) || 0;
          const net = row.netPrice != null
            ? Number(row.netPrice)
            : (row.discountType === 'Percentage'
              ? base - Math.round((base * Number(row.discountValue || 0)) / 100)
              : row.discountType === 'Fixed'
                ? Math.max(0, base - Number(row.discountValue || 0))
                : base);
          return (
            <div key={`${unit}-${count}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1.4fr 1fr 1fr auto', gap: '8px', alignItems: 'center', background: '#fff', padding: '6px 12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: '12px', fontWeight: 600 }}>{formatDurationLabel(count, unit)}</span>
              <span style={{ fontSize: '12px' }}>₹{base.toLocaleString('en-IN')}</span>
              <select
                className="form-select"
                aria-label={`Discount type ${formatDurationLabel(count, unit)}`}
                style={{ padding: '4px 8px', fontSize: '12px' }}
                value={row.discountType || 'None'}
                onChange={e => {
                  const discountType = e.target.value;
                  const tiers = tiersFromRows(rows).map(tier => tier.count === count ? { ...tier, discountType, discountValue: discountType === 'None' ? 0 : tier.discountValue } : tier);
                  emit(unitPrice, tiers);
                }}
              >
                <option value="None">No Discount</option>
                <option value="Percentage">% Discount</option>
                <option value="Fixed">₹ Discount</option>
              </select>
              <NumericInput
                className="form-input"
                aria-label={`Discount ${formatDurationLabel(count, unit)}`}
                style={{ padding: '4px 8px', fontSize: '12px' }}
                value={row.discountValue || 0}
                onChange={e => {
                  const discountValue = Number(e.target.value) || 0;
                  const tiers = tiersFromRows(rows).map(tier => tier.count === count ? { ...tier, discountValue } : tier);
                  emit(unitPrice, tiers);
                }}
              />
              <span style={{ fontSize: '12px', fontWeight: 600 }}>Net ₹{Number(net || 0).toLocaleString('en-IN')}</span>
              <button
                type="button"
                className="btn btn-ghost"
                aria-label={`Remove ${formatDurationLabel(count, unit)}`}
                style={{ color: '#ef4444', padding: '2px' }}
                onClick={() => emit(unitPrice, tiersFromRows(rows).filter(tier => tier.count !== count))}
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
        {rows.length === 0 && (
          <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: 0 }}>Select at least one duration above.</p>
        )}
      </div>

      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '8px' }}>
        <NumericInput
          className="form-input"
          aria-label={unit === 'day' ? 'Custom days' : unit === 'year' ? 'Custom years' : 'Custom months'}
          style={{ width: '88px', padding: '4px 8px', fontSize: '12px' }}
          value={customCount}
          onChange={e => setCustomCount(e.target.value)}
        />
        <button type="button" className="btn btn-ghost" style={{ fontSize: '11px', border: '1px solid #cbd5e1' }} onClick={addCustom}>
          + Add {unit === 'day' ? 'Days' : unit === 'year' ? 'Years' : 'Months'}
        </button>
      </div>
    </div>
  );
}
