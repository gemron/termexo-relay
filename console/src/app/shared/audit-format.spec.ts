import type { AuditView, DeviceView, UserView } from '../core/console.models';
import {
  describeActor,
  describeTarget,
  formatAuditAction,
  formatAuditDetail,
  type Translate,
} from './audit-format';
import { buildNameDirectory, EMPTY_NAME_DIRECTORY, shortId } from './name-directory';

const USER_ID = 'dMCLj0KZBACZvkbBlELKMQ';
const DEVICE_ID = '2j5slb3mm4r2jgfa3szvuoubjy';

/**
 * Wording is asserted by key, not by sentence: this module's job is choosing the right key and
 * substituting the right values, and a test that repeats the Chinese only tests the copy.
 */
const translate: Translate = (key, params = {}) => {
  const rendered = Object.entries(params)
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(',');
  return rendered ? `${key}(${rendered})` : key;
};

function user(overrides: Partial<UserView> = {}): UserView {
  return {
    id: USER_ID,
    username: 'admin',
    role: 'admin',
    disabled: false,
    createdAt: 1,
    lastLoginAt: null,
    deviceCount: 0,
    ...overrides,
  };
}

function device(overrides: Partial<DeviceView> = {}): DeviceView {
  return {
    id: DEVICE_ID,
    kind: 'desktop',
    name: '书房台式机',
    ownerUserId: USER_ID,
    ownerUsername: 'admin',
    online: true,
    connectedSince: 1,
    lastSeenAt: 2,
    lastIp: '127.0.0.1',
    lastVersion: '0.10.0',
    via: [],
    viaNames: [],
    revokedAt: null,
    note: null,
    accessUrl: 'https://relay.example.com/d/abc/',
    access: 'public',
    ...overrides,
  };
}

function event(overrides: Partial<AuditView> = {}): AuditView {
  return {
    id: 1,
    at: 1_000,
    actorKind: 'user',
    actorId: USER_ID,
    action: 'login',
    targetKind: 'user',
    targetId: USER_ID,
    ip: '127.0.0.1',
    detail: null,
    ...overrides,
  };
}

describe('shortId', () => {
  it('keeps enough of an identifier to tell two of them apart', () => {
    expect(shortId(USER_ID)).toBe('dMCLj0KZ…');
  });

  it('leaves an already short identifier alone', () => {
    expect(shortId('admin')).toBe('admin');
  });
});

describe('buildNameDirectory', () => {
  it('answers with the name for a user and for a device', () => {
    const directory = buildNameDirectory([user()], [device()]);

    expect(directory.get(USER_ID)).toBe('admin');
    expect(directory.get(DEVICE_ID)).toBe('书房台式机');
  });

  it('takes the devices as optional, for a screen that only knows about users', () => {
    expect(buildNameDirectory([user()]).get(USER_ID)).toBe('admin');
  });
});

describe('formatAuditAction', () => {
  it('reads every action the relay writes as a phrase', () => {
    expect(formatAuditAction('tunnel-connected', translate)).toBe(
      'console.audit.actionTunnelConnected',
    );
    expect(formatAuditAction('bootstrap-admin', translate)).toBe(
      'console.audit.actionBootstrapAdmin',
    );
  });

  it('shows an action a newer relay invented rather than an empty cell', () => {
    expect(formatAuditAction('something-new', translate)).toBe('something-new');
  });
});

describe('describeActor and describeTarget', () => {
  const directory = buildNameDirectory([user()], [device()]);

  it('names the user behind a row and keeps the identifier as a hint', () => {
    const actor = describeActor(event(), directory, translate);

    expect(actor.label).toBe('admin');
    expect(actor.hint).toBe('console.audit.actorUser · dMCLj0KZ…');
    expect(actor.title).toBe(USER_ID);
  });

  it('names the device a tunnel event is about', () => {
    const target = describeTarget(
      event({ actorKind: 'device', targetKind: 'device', targetId: DEVICE_ID }),
      directory,
      translate,
    );

    expect(target.label).toBe('书房台式机');
  });

  it('says so when a user the row points at is no longer on this relay', () => {
    const target = describeTarget(event({ targetId: 'gone-from-here-1' }), directory, translate);

    expect(target.label).toBe('gone-fro…');
    expect(target.hint).toContain('console.audit.unresolved');
  });

  it('does not cry "deleted" over a kind the console never names', () => {
    const target = describeTarget(
      event({ targetKind: 'enrollment', targetId: 'IX7udWk06GR7usNmxJB1Bw' }),
      directory,
      translate,
    );

    expect(target.label).toBe('IX7udWk0…');
    expect(target.hint).toBe('console.audit.targetEnrollment');
  });

  it('falls back to short identifiers when no directory has been loaded yet', () => {
    expect(describeActor(event(), EMPTY_NAME_DIRECTORY, translate).label).toBe('dMCLj0KZ…');
  });

  it('shows a system actor as the system, with nothing to look up', () => {
    const actor = describeActor(
      event({ actorKind: 'system', actorId: null }),
      directory,
      translate,
    );

    expect(actor).toEqual({ label: 'console.audit.actorSystem', hint: '', title: '' });
  });

  it('leaves an event with no object empty, so the cell can show its own dash', () => {
    const target = describeTarget(
      event({ targetKind: null, targetId: null }),
      directory,
      translate,
    );

    expect(target.label).toBe('');
  });
});

describe('formatAuditDetail', () => {
  it('reads a detail object as labelled pairs', () => {
    const detail = formatAuditDetail('{"kind":"desktop","ttlMinutes":60}', translate);

    expect(detail).toBe(
      'console.audit.detailPair(label=console.audit.detailKind,value=console.devices.kindDesktop)' +
        ' · console.audit.detailPair(label=console.audit.detailTtl,' +
        'value=console.audit.minutes(count=60))',
    );
  });

  it('reads a boolean as a word', () => {
    expect(formatAuditDetail('{"pinned":false}', translate)).toContain('value=console.common.no');
  });

  it('spells out each field a user update touched', () => {
    expect(formatAuditDetail('{"changed":"role,password"}', translate)).toContain(
      'value=console.audit.fieldRoleconsole.audit.listSeparatorconsole.audit.fieldPassword',
    );
  });

  it('keeps free text as it was recorded', () => {
    expect(formatAuditDetail('{"username":"ada"}', translate)).toContain('value=ada');
  });

  it('names a field a newer relay added instead of dropping it', () => {
    expect(formatAuditDetail('{"brandNew":"x"}', translate)).toBe(
      'console.audit.detailPair(label=brandNew,value=x)',
    );
  });

  it('shows detail that is not a JSON object as it stands', () => {
    expect(formatAuditDetail('not json at all', translate)).toBe('not json at all');
  });

  it('has nothing to say about an empty detail', () => {
    expect(formatAuditDetail(null, translate)).toBe('');
    expect(formatAuditDetail('   ', translate)).toBe('');
  });
});
