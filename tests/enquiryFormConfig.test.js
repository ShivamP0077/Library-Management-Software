import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENQUIRY_CORE_ORDER,
  normalizeEnquiryForm,
  planChoiceOptions,
  resolveEnquiryForm,
} from '../src/utils/enquiryFormConfig.js';

test('defaults match the original public form and lock name and mobile', () => {
  const cfg = normalizeEnquiryForm(undefined);
  assert.deepEqual(ENQUIRY_CORE_ORDER, ['name', 'mobile', 'email', 'gender', 'branch', 'section']);
  assert.equal(cfg.fields.name.show, true);
  assert.equal(cfg.fields.name.required, true);
  assert.equal(cfg.fields.mobile.required, true);
  assert.equal(cfg.fields.email.show, true);
  assert.equal(cfg.fields.email.required, false);
  assert.equal(cfg.fields.gender.show, true);
  assert.equal(cfg.fields.gender.required, true);
  assert.equal(cfg.documents.show, true);
  assert.equal(cfg.documents.required, false);
  assert.equal(cfg.plan.show, true);
  assert.equal(cfg.plan.required, false);
  const locked = normalizeEnquiryForm({ fields: { name: { show: false, required: false }, mobile: { show: false, required: false } } });
  assert.equal(locked.fields.name.show, true);
  assert.equal(locked.fields.mobile.required, true);
});

test('resolveEnquiryForm hides branch and section when there are no options or the owner turned them off', () => {
  const none = resolveEnquiryForm({}, { branches: [], sections: [] });
  assert.equal(none.fields.branch.show, false);
  assert.equal(none.fields.section.show, false);
  const many = resolveEnquiryForm(
    { enquiryForm: { fields: { branch: { show: false, required: true } } } },
    { branches: [{ id: 'b1', name: 'North' }, { id: 'b2', name: 'South' }], sections: [{ id: 's1', name: 'A', branchId: 'b1' }] },
  );
  assert.equal(many.fields.branch.show, false);
  assert.equal(many.branches.length, 2);
  assert.equal(many.fields.section.show, true);
});

test('owner can offer a subset or custom branch and section options', () => {
  const resolved = resolveEnquiryForm(
    { enquiryForm: { branches: [{ id: 'b2', name: 'South Campus' }, { id: 'custom-1', name: 'Popup stall' }] } },
    { branches: [{ id: 'b1', name: 'North' }, { id: 'b2', name: 'South' }], sections: [] },
  );
  assert.deepEqual(resolved.branches.map((b) => b.id), ['b2', 'custom-1']);
  assert.equal(resolved.branches[0].name, 'South Campus');
});

test('planChoiceOptions ignores software SaaS plans', () => {
  const list = planChoiceOptions([
    { id: 'p1', name: 'Full Day', price: 999 },
    { id: 'saas', name: 'Pro', priceMonthly: 499, planId: 'pro' },
    { name: '' },
  ]);
  assert.deepEqual(list, [{ id: 'p1', name: 'Full Day', price: 999 }]);
});
