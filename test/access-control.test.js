'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  phoneNumberFromIdentifier,
  canonicalAdmin,
  collectMessageIdentifiers,
  ownerNumbers,
  resolveAccess
} = require('../src/services/access-control');

test('normalise les numéros, JID et anciens documents Mongo admin', () => {
  assert.equal(phoneNumberFromIdentifier('+509 47 44 0869'), '50947440869');
  assert.equal(phoneNumberFromIdentifier('50947440869:12@s.whatsapp.net'), '50947440869');
  assert.equal(phoneNumberFromIdentifier('123456789@lid'), '');
  assert.deepEqual(canonicalAdmin({ number: '+509 36 00 0000' }), {
    raw: '+509 36 00 0000',
    number: '50936000000',
    jid: '50936000000@s.whatsapp.net'
  });
});

test('reconnaît plusieurs propriétaires configurés dans OWNER_NUMBER', () => {
  assert.deepEqual(ownerNumbers('50911111111, +509 2222 2222;50933333333@s.whatsapp.net'), [
    '50911111111', '50922222222', '50933333333'
  ]);
  const identifiers = collectMessageIdentifiers({ key: { participant: '50922222222:7@s.whatsapp.net' } });
  assert.equal(resolveAccess({ identifiers, ownerValue: '50911111111,50922222222' }).isOwner, true);
});

test('reconnaît un admin Mongo enregistré comme numéro ou JID', () => {
  const identifiers = collectMessageIdentifiers({ key: { participant: '50944444444@s.whatsapp.net' } });
  const access = resolveAccess({
    identifiers,
    ownerValue: '50911111111',
    adminEntries: [{ jid: '+509 4444 4444' }],
    sessionNumber: '50999999999'
  });
  assert.equal(access.isOwner, false);
  assert.equal(access.isMongoAdmin, true);
  assert.equal(access.isPrivileged, true);
});

test('utilise participantAlt pour relier un expéditeur LID à son numéro', () => {
  const msg = { key: {
    participant: '123456789012345@lid',
    participantAlt: '50955555555@s.whatsapp.net'
  } };
  const identifiers = collectMessageIdentifiers(msg);
  assert.equal(resolveAccess({ identifiers, adminEntries: ['50955555555'] }).isMongoAdmin, true);
});

test('le numéro de la session est reconnu comme propriétaire de sa propre session', () => {
  const identifiers = collectMessageIdentifiers({ key: { fromMe: true } }, '50977777777@s.whatsapp.net');
  const access = resolveAccess({ identifiers, ownerValue: '', sessionNumber: '50977777777' });
  assert.equal(access.isSessionOwner, true);
  assert.equal(access.isOwner, true);
});

test('un sudo est privilégié uniquement lorsqu’il figure dans la configuration de cette session', () => {
  const identifiers = collectMessageIdentifiers({ key: { participant: '50988888888@s.whatsapp.net' } });
  const allowed = resolveAccess({
    identifiers,
    sudoEntries: ['50988888888'],
    sessionNumber: '50911111111'
  });
  const denied = resolveAccess({
    identifiers,
    sudoEntries: ['50999999999'],
    sessionNumber: '50922222222'
  });
  assert.equal(allowed.isSudo, true);
  assert.equal(allowed.isPrivileged, true);
  assert.equal(denied.isSudo, false);
  assert.equal(denied.isPrivileged, false);
});
