import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { copyText } from '../src/utils/copyText.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

function fakeDoc() {
  const nodes = [];
  return {
    nodes,
    body: {
      appendChild(node) { nodes.push(node); },
      removeChild(node) {
        const i = nodes.indexOf(node);
        if (i >= 0) nodes.splice(i, 1);
      },
    },
    createElement() {
      return {
        value: '',
        style: {},
        setAttribute() {},
        focus() {},
        select() { this.selected = true; },
      };
    },
    execCommand(cmd) {
      assert.equal(cmd, 'copy');
      return true;
    },
  };
}

test('copyText uses clipboard.writeText when it succeeds', async () => {
  let copied = '';
  const nav = { clipboard: { writeText: async (value) => { copied = value; } } };
  const doc = fakeDoc();
  assert.equal(await copyText('invite-link', { nav, doc }), true);
  assert.equal(copied, 'invite-link');
  assert.equal(doc.nodes.length, 0);
});

test('copyText falls back when clipboard.writeText throws', async () => {
  const nav = { clipboard: { writeText: async () => { throw new Error('not allowed'); } } };
  const doc = fakeDoc();
  assert.equal(await copyText('https://app.example/invite/abc', { nav, doc }), true);
  assert.equal(doc.execCommand('copy'), true);
});

test('copyText uses the textarea fallback when clipboard is missing', async () => {
  const doc = fakeDoc();
  assert.equal(await copyText('plain', { nav: {}, doc }), true);
  assert.equal(doc.nodes.length, 0);
});

test('Add Staff copy shows a Copied toast', () => {
  const settings = read('../src/components/LibrarySettings.jsx');
  assert.match(settings, /copyText\(/);
  assert.match(settings, /toast\.success\('Copied'\)/);
});
