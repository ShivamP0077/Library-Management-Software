#!/usr/bin/env node
/**
 * Optional backfill: write the inferred 12-month discount onto SoftwarePlan.durationPricing
 * so the Super Admin editor can show it. Does not touch SoftwareInvoice or Library.subscription.
 *
 * Dry-run unless --apply is passed. Refuses any MongoDB host that is not localhost / 127.0.0.1.
 * --apply writes a rollback JSONL first, then updates plans that have no durationPricing.year.
 *
 *   node scripts/backfill-software-plan-durations.mjs --uri mongodb://127.0.0.1:27017/libraryos
 *   node scripts/backfill-software-plan-durations.mjs --uri mongodb://127.0.0.1:27017/libraryos --apply
 */
import fs from 'fs';
import mongoose from 'mongoose';
import { priceQuote } from '../src/billing.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const uriFlag = args.indexOf('--uri');
const uri = uriFlag >= 0 ? args[uriFlag + 1] : '';

function assertLocalUri(value) {
  let host = '';
  try { host = new URL(value).hostname; } catch { throw new Error('MongoDB URI is missing or invalid'); }
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`Refusing non-localhost MongoDB host "${host}"`);
}

export function inferredYearRow(plan) {
  if (plan?.durationPricing?.year) return null;
  const quote = priceQuote({ priceMonthly: plan?.priceMonthly, priceYearly: plan?.priceYearly }, 'year');
  if (!quote?.available) return null;
  return {
    offered: true,
    discountType: quote.discountType,
    discountValue: quote.discountValue,
  };
}

async function main() {
  assertLocalUri(uri);
  await mongoose.connect(uri);
  const plans = mongoose.connection.collection('softwareplans');
  const docs = await plans.find({}).toArray();
  const changes = [];
  for (const doc of docs) {
    const year = inferredYearRow(doc);
    if (!year) continue;
    changes.push({ planId: doc.planId, before: doc.durationPricing || null, year });
  }
  console.log(JSON.stringify({ apply, plans: docs.length, wouldWrite: changes.length, changes }, null, 2));
  if (!apply) {
    console.log('Dry run only. No plans were updated.');
    await mongoose.disconnect();
    return;
  }
  const rollback = `software-plan-duration-rollback-${Date.now()}.jsonl`;
  fs.writeFileSync(rollback, changes.map(row => JSON.stringify({ planId: row.planId, durationPricing: row.before })).join('\n') + (changes.length ? '\n' : ''));
  console.log(`Wrote rollback ${rollback}`);
  for (const row of changes) {
    await plans.updateOne({ planId: row.planId }, { $set: { 'durationPricing.year': row.year } });
  }
  console.log(`Updated ${changes.length} plans. Invoices were not changed.`);
  await mongoose.disconnect();
}

if (process.argv[1] && process.argv[1].endsWith('backfill-software-plan-durations.mjs')) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}
