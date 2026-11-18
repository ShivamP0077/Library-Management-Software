import test from 'node:test';
import assert from 'node:assert/strict';
import { readInviteToken } from '../src/utils/inviteToken.js';

const loc = (partial) => ({ pathname: '/', search: '', hash: '', ...partial });

test('invite token is read from the path, query, or hash', () => {
  assert.equal(readInviteToken(loc({ pathname: '/invite/abc_def-1' })), 'abc_def-1');
  assert.equal(readInviteToken(loc({ pathname: '/invite/a%2Fb' })), 'a/b');
  assert.equal(readInviteToken(loc({ search: '?invite=query-token' })), 'query-token');
  assert.equal(readInviteToken(loc({ hash: '#invite=hash-token' })), 'hash-token');
  assert.equal(readInviteToken(loc({ pathname: '/invite/path-token', search: '?invite=query', hash: '#invite=hash' })), 'path-token');
  assert.equal(readInviteToken(loc({})), '');
  assert.equal(readInviteToken(null), '');
});
