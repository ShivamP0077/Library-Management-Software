import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('student list and profile photos open a lightbox that can close', () => {
  const manager = read('../src/components/StudentManager.jsx');
  const photo = read('../src/components/StudentPhotoThumb.jsx');
  const css = read('../src/responsive.css');

  assert.match(photo, /useStudentPhoto/);
  assert.match(photo, /findPhotoDoc/);
  assert.match(photo, /if \(!hasPhoto\) return null/);
  assert.match(photo, /e\.stopPropagation\(\)/);
  assert.match(photo, /e\.key === 'Escape'/);
  assert.match(photo, /onClick=\{onClose\}/);
  assert.match(photo, /zIndex: 1200/);
  assert.match(photo, /aria-label="Close photo"/);
  assert.match(photo, /student-photo-lightbox/);

  assert.match(manager, /StudentPhotoThumb/);
  assert.match(manager, /StudentPhotoLightbox/);
  assert.match(manager, /setPhotoLightbox\(\{ src, name \}\)/);
  assert.match(manager, /setPhotoLightbox\(\{ src: profilePhoto/);
  assert.match(manager, /Open photo of/);
  assert.doesNotMatch(manager, /sp-avatar[\s\S]{0,400}onClick=\{\(\) => setPhotoLightbox/);

  assert.match(css, /\.st-photo \{/);
  assert.match(css, /\.student-photo-lightbox/);
  assert.match(css, /min-width: 44px/);
});
