/*
 * Behaviour test for per-channel attachment drafts + multi-attach.
 * Run: node tests/attachment_drafts.test.js
 *
 * js/app.js is a DOM-bound IIFE, so we assert on its structure rather than
 * importing it, then exercise the draft/merge semantics in a small harness.
 * This still catches the regression class we actually shipped a bug for: a
 * single global pending array leaking attachments across channels.
 */
const fs = require('fs');
const path = require('path');

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log('  ok   ' + name);
  } else {
    console.log('  FAIL ' + name);
    failures += 1;
  }
}

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

console.log('static assertions on js/app.js');
check('no global pendingFiles assignment remains', !/[^\w.]pendingFiles\s*=/.test(src));
check('per-channel map declared', /attachmentsByChannel/.test(src));
check(
  'draft helpers present',
  /function getPending\(/.test(src) &&
    /function setPending\(/.test(src) &&
    /function clearPending\(/.test(src)
);
check(
  'selectChannel refreshes the attach label',
  /async function selectChannel[\s\S]{0,500}updateAttachLabel\(\)/.test(src)
);
check('onFilesChosen appends rather than replaces', !/pendingFiles = Array.from\(input\.files/.test(src));
check('file input allows multiple', /id="fileInput"[^>]*multiple/.test(html));

// ---- behavioural harness mirroring getPending/setPending/merge ----
const attachmentsByChannel = Object.create(null);
const getPending = (ch) => {
  const k = ch || '__none__';
  if (!attachmentsByChannel[k]) attachmentsByChannel[k] = [];
  return attachmentsByChannel[k];
};
const setPending = (ch, list) => {
  attachmentsByChannel[ch || '__none__'] = (list || []).filter(Boolean);
};
const sig = (f) => [f.name, f.size, f.lastModified].join(':');
const merge = (ch, chosen) => {
  const seen = Object.create(null);
  getPending(ch).forEach((f) => {
    seen[sig(f)] = true;
  });
  const merged = getPending(ch).slice();
  let dupes = 0;
  chosen.forEach((f) => {
    if (seen[sig(f)]) {
      dupes += 1;
      return;
    }
    seen[sig(f)] = true;
    merged.push(f);
  });
  setPending(ch, merged);
  return dupes;
};
const f = (name, size) => ({ name, size, lastModified: 1 });

console.log('\nbehavioural assertions');
merge('A', [f('a.png', 1)]);
check('attach in A lands in A', getPending('A').length === 1);
check('B starts empty (no leak)', getPending('B').length === 0);
merge('B', [f('b.pdf', 2)]);
check('B has its own file', getPending('B').length === 1);
check('A untouched by B', getPending('A')[0].name === 'a.png');
merge('A', [f('c.png', 3)]);
check('switching back to A restores + appends', getPending('A').length === 2);
check('multi-attach accumulates', getPending('A').map((x) => x.name).join(',') === 'a.png,c.png');
const dupes = merge('A', [f('a.png', 1)]);
check('duplicate pick is skipped', dupes === 1 && getPending('A').length === 2);
setPending('A', []);
check('send clears only A', getPending('A').length === 0 && getPending('B').length === 1);
const total = Object.keys(attachmentsByChannel).reduce((n, k) => n + attachmentsByChannel[k].length, 0);
check('other-channel draft still parked', total === 1);

console.log(failures === 0 ? '\nALL OK' : '\nFAILURES=' + failures);
process.exit(failures === 0 ? 0 : 1);
