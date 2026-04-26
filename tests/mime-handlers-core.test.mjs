import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getAppsForMimeType } from '../mime-handlers-core.mjs';

const fixtureRegistry = [
  {
    id: 'notepad',
    name: 'Notepad',
    shortName: 'Notepad',
    icon: '📝',
    handles: ['text/*', 'application/json']
  },
  {
    id: 'surf',
    name: 'Surf',
    shortName: 'Surf',
    icon: '🌊',
    handles: ['text/html']
  },
  {
    id: 'media',
    name: 'Media',
    shortName: 'Media',
    icon: '🎵',
    handles: ['video/mp4', 'video/*']
  }
];

describe('getAppsForMimeType', () => {
  it('returns empty for falsy mime', () => {
    assert.deepEqual(getAppsForMimeType('', fixtureRegistry), []);
    assert.deepEqual(getAppsForMimeType(undefined, fixtureRegistry), []);
  });

  it('orders exact match before wildcard', () => {
    const r = getAppsForMimeType('video/mp4', fixtureRegistry);
    assert.equal(r.length, 1);
    assert.equal(r[0].appId, 'media');
  });

  it('matches wildcard type', () => {
    const r = getAppsForMimeType('video/webm', fixtureRegistry);
    assert.equal(r.length, 1);
    assert.equal(r[0].appId, 'media');
  });

  it('matches text/* for text/plain', () => {
    const r = getAppsForMimeType('text/plain', fixtureRegistry);
    assert.equal(r.length, 1);
    assert.equal(r[0].appId, 'notepad');
  });

  it('returns both exact and wildcard when two apps match', () => {
    const r = getAppsForMimeType('text/html', fixtureRegistry);
    const ids = r.map((x) => x.appId).sort();
    assert.deepEqual(ids, ['notepad', 'surf']);
    assert.equal(r[0].appId, 'surf');
    assert.equal(r[1].appId, 'notepad');
  });
});
