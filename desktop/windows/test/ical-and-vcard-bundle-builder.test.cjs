'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildIcalAndVcardStrings,
  saveIcalAndVcardToWorkspace
} = require('../workspace/ical-and-vcard-bundle-builder.cjs');

test('iCal & vCard bundle builder produces RFC 5545 and RFC 6350 artifacts and saves cleanly', () => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmora-ical-vcard-'));

  const bundle = buildIcalAndVcardStrings({
    events: [
      {
        uid: 'evt-release-60@kosmora.ai',
        summary: 'Phase 10 Release & Verification',
        description: 'Deploy Raft, LTL, LSM-Tree, and DRF modules',
        location: 'Nexus Control Room',
        startIso: '2026-11-04T10:00:00Z',
        endIso: '2026-11-04T11:30:00Z'
      }
    ],
    contacts: [
      {
        fullName: 'Alexey Kosmora',
        organization: 'RLM Company',
        email: 'alexey@kosmora.ai',
        phone: '+7-900-000-0000'
      }
    ]
  });

  assert.match(bundle.ics, /BEGIN:VCALENDAR/);
  assert.match(bundle.ics, /SUMMARY:Phase 10 Release & Verification/);
  assert.match(bundle.ics, /BEGIN:VALARM/);
  assert.match(bundle.vcf, /BEGIN:VCARD/);
  assert.match(bundle.vcf, /VERSION:4\.0/);
  assert.match(bundle.vcf, /FN:Alexey Kosmora/);

  const saved = saveIcalAndVcardToWorkspace(workspaceDir, 'Kosmora Release Schedule', {
    events: [
      {
        summary: 'Cutover Window',
        startIso: '2026-11-05T08:00:00Z',
        endIso: '2026-11-05T09:00:00Z'
      }
    ],
    contacts: [
      {
        fullName: 'Kosmora Ops Bot',
        email: 'bot@kosmora.ai'
      }
    ]
  });

  assert.equal(fs.existsSync(saved.icsPath), true);
  assert.equal(fs.existsSync(saved.vcfPath), true);
  assert.equal(saved.sha256.length, 64);

  assert.throws(() => {
    saveIcalAndVcardToWorkspace('', 'escape', {});
  }, /WORKSPACE_REQUIRED/);
});
