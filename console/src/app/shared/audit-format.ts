import type { AuditView } from '../core/console.models';
import { type NameDirectory, shortId } from './name-directory';

/**
 * Turning an audit row into something a person can read.
 *
 * The relay records machine-facing values — action slugs, opaque identifiers, a compact JSON
 * detail object — because they are stable and cheap to match on. Everything that turns them into
 * words lives here rather than in a page, because the overview and the audit page show the same
 * rows and must never disagree about what one of them means.
 */

/** Between the parts of one cell, and between the pairs of a detail object. */
const PART_SEPARATOR = ' · ';

/** The one thing this module needs from `I18nService`, so it stays a pure function module. */
export type Translate = (key: string, params?: Readonly<Record<string, string | number>>) => string;

/** Every action name `src/audit.rs` can write. An unknown one falls back to the raw slug. */
const ACTION_LABEL_KEYS: Readonly<Record<string, string>> = {
  login: 'console.audit.actionLogin',
  'login-failed': 'console.audit.actionLoginFailed',
  enroll: 'console.audit.actionEnroll',
  'enroll-failed': 'console.audit.actionEnrollFailed',
  'device-revoked': 'console.audit.actionDeviceRevoked',
  'device-disconnected': 'console.audit.actionDeviceDisconnected',
  'device-updated': 'console.audit.actionDeviceUpdated',
  'device-access-changed': 'console.audit.actionDeviceAccessChanged',
  'tunnel-connected': 'console.audit.actionTunnelConnected',
  'tunnel-disconnected': 'console.audit.actionTunnelDisconnected',
  'tunnel-rejected': 'console.audit.actionTunnelRejected',
  'user-created': 'console.audit.actionUserCreated',
  'user-updated': 'console.audit.actionUserUpdated',
  'user-deleted': 'console.audit.actionUserDeleted',
  'enrollment-created': 'console.audit.actionEnrollmentCreated',
  'enrollment-cancelled': 'console.audit.actionEnrollmentCancelled',
  'bootstrap-admin': 'console.audit.actionBootstrapAdmin',
  'upstream-linked': 'console.audit.actionUpstreamLinked',
  'upstream-unlinked': 'console.audit.actionUpstreamUnlinked',
  'upstream-connected': 'console.audit.actionUpstreamConnected',
  'upstream-disconnected': 'console.audit.actionUpstreamDisconnected',
  'upstream-loop-refused': 'console.audit.actionUpstreamLoopRefused',
  'upstream-revoked': 'console.audit.actionUpstreamRevoked',
};

/** Both actor kinds and target kinds; the relay spells them the same way. */
const ENTITY_KIND_KEYS: Readonly<Record<string, string>> = {
  user: 'console.audit.actorUser',
  device: 'console.audit.actorDevice',
  system: 'console.audit.actorSystem',
  enrollment: 'console.audit.targetEnrollment',
  relay: 'console.audit.targetRelay',
};

/**
 * The kinds a directory is expected to have a name for.
 *
 * An enrolment code and a foreign relay have no name anywhere in the console, so failing to
 * resolve one of those is normal and saying "deleted" about it would be a lie.
 */
const NAMED_KINDS: ReadonlySet<string> = new Set(['user', 'device']);

/** The field names the relay puts in `detail`. */
const DETAIL_LABEL_KEYS: Readonly<Record<string, string>> = {
  access: 'console.audit.detailAccess',
  cause: 'console.audit.detailCause',
  change: 'console.audit.detailChange',
  changed: 'console.audit.detailChanged',
  kind: 'console.audit.detailKind',
  pinned: 'console.audit.detailPinned',
  reason: 'console.audit.detailReason',
  role: 'console.audit.detailRole',
  ttlMinutes: 'console.audit.detailTtl',
  url: 'console.audit.detailUrl',
  username: 'console.audit.detailUsername',
  version: 'console.audit.detailVersion',
};

/** Detail values the relay writes as slugs. Free text — a username, a URL — is shown as recorded. */
const DETAIL_VALUE_KEYS: Readonly<Record<string, string>> = {
  desktop: 'console.devices.kindDesktop',
  relay: 'console.devices.kindRelay',
  admin: 'console.role.admin',
  user: 'console.role.user',
  public: 'console.audit.valuePublic',
  'relay-login': 'console.audit.valueRelayLogin',
  password: 'console.audit.valuePassword',
  'password-reset': 'console.audit.valuePasswordReset',
  'malformed-credential': 'console.audit.valueMalformedCredential',
  'lookup-failed': 'console.audit.valueLookupFailed',
  'unknown-device': 'console.audit.valueUnknownDevice',
  revoked: 'console.audit.valueRevoked',
  'secret-mismatch': 'console.audit.valueSecretMismatch',
  'peer-closed': 'console.audit.valuePeerClosed',
  'idle-timeout': 'console.audit.valueIdleTimeout',
  'transport-error': 'console.audit.valueTransportError',
  'closed-by-relay': 'console.audit.valueClosedByRelay',
};

/** `changed` carries a comma-separated list of the user fields an update touched. */
const CHANGED_FIELD_KEY = 'changed';
const CHANGED_FIELD_SEPARATOR = ',';
const CHANGED_FIELD_KEYS: Readonly<Record<string, string>> = {
  disabled: 'console.audit.fieldDisabled',
  role: 'console.audit.fieldRole',
  password: 'console.audit.fieldPassword',
};

const TTL_MINUTES_KEY = 'ttlMinutes';

/** One party of an audit row, as a table cell shows it. */
export interface EntityRef {
  /** The name, when it is known; the short identifier otherwise. */
  readonly label: string;
  /** The muted second line: what kind of thing it is, and which one. Empty when there is nothing. */
  readonly hint: string;
  /** The whole identifier, for the cell's tooltip. Empty when the row names no identifier. */
  readonly title: string;
}

const ABSENT_ENTITY: EntityRef = { label: '', hint: '', title: '' };

/**
 * Reads one identifier as a name plus its provenance.
 *
 * A user or device the directory cannot resolve is not an error: accounts get deleted, and a
 * downstream relay announces devices this relay has no row for. Those say so, rather than
 * leaving an operator to wonder why a name is missing.
 */
export function describeEntity(
  kind: string | null | undefined,
  id: string | null | undefined,
  directory: NameDirectory,
  translate: Translate,
): EntityRef {
  const kindLabel = kind ? translate(ENTITY_KIND_KEYS[kind] ?? kind) : '';
  if (!id) {
    // A system actor and an action with no object both land here; the kind is all there is to say.
    return kindLabel ? { label: kindLabel, hint: '', title: '' } : ABSENT_ENTITY;
  }
  const name = directory.get(id);
  if (name !== undefined) {
    return { label: name, hint: join(kindLabel, shortId(id)), title: id };
  }
  const missing = kind && NAMED_KINDS.has(kind) ? translate('console.audit.unresolved') : '';
  return { label: shortId(id), hint: join(kindLabel, missing), title: id };
}

function join(...parts: readonly string[]): string {
  return parts.filter(Boolean).join(PART_SEPARATOR);
}

export function describeActor(
  event: AuditView,
  directory: NameDirectory,
  translate: Translate,
): EntityRef {
  return describeEntity(event.actorKind, event.actorId, directory, translate);
}

export function describeTarget(
  event: AuditView,
  directory: NameDirectory,
  translate: Translate,
): EntityRef {
  return describeEntity(event.targetKind, event.targetId, directory, translate);
}

/** The action, as a phrase. An action the console has no wording for keeps its own name. */
export function formatAuditAction(action: string, translate: Translate): string {
  const key = ACTION_LABEL_KEYS[action];
  return key ? translate(key) : action;
}

/**
 * The detail object, as `label: value` pairs.
 *
 * Detail is a contract between two versions of the relay, not a sentence, so a field this console
 * does not know is still shown — under its own name — rather than dropped.
 */
export function formatAuditDetail(detail: string | null | undefined, translate: Translate): string {
  const raw = detail?.trim();
  if (!raw) {
    return '';
  }
  const fields = parseDetail(raw);
  if (!fields) {
    return raw;
  }
  return Object.entries(fields)
    .map(([key, value]) =>
      translate('console.audit.detailPair', {
        label: translate(DETAIL_LABEL_KEYS[key] ?? key),
        value: formatDetailValue(key, value, translate),
      }),
    )
    .join(PART_SEPARATOR);
}

function parseDetail(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Not JSON at all. Whatever it is, showing it beats showing nothing.
  }
  return null;
}

function formatDetailValue(key: string, value: unknown, translate: Translate): string {
  if (typeof value === 'boolean') {
    return translate(value ? 'console.common.yes' : 'console.common.no');
  }
  if (value === null || value === undefined) {
    return translate('console.common.none');
  }
  if (key === TTL_MINUTES_KEY && typeof value === 'number') {
    return translate('console.audit.minutes', { count: value });
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value !== 'string') {
    return JSON.stringify(value);
  }
  if (key === CHANGED_FIELD_KEY) {
    return formatChangedFields(value, translate);
  }
  const valueKey = DETAIL_VALUE_KEYS[value];
  return valueKey ? translate(valueKey) : value;
}

function formatChangedFields(value: string, translate: Translate): string {
  return value
    .split(CHANGED_FIELD_SEPARATOR)
    .map((field) => field.trim())
    .filter(Boolean)
    .map((field) => translate(CHANGED_FIELD_KEYS[field] ?? field))
    .join(translate('console.audit.listSeparator'));
}
