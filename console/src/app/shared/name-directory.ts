import type { DeviceView, UserView } from '../core/console.models';

/**
 * Identifiers to the names an operator knows them by.
 *
 * The relay stores references as identifiers, which is right for a database and useless in a
 * table: nobody recognises `dMCLj0KZBACZvkbBlELKMQ`. Every screen that shows a stored reference
 * resolves it through here, so "who did this" reads the same way wherever it appears.
 */

/** Enough of an identifier to recognise a row by, without filling the column with it. */
const SHORT_ID_LENGTH = 8;
const ELLIPSIS = '…';

export type NameDirectory = ReadonlyMap<string, string>;

export const EMPTY_NAME_DIRECTORY: NameDirectory = new Map<string, string>();

/**
 * One lookup table for the identifiers a console page can run into.
 *
 * Users and devices are the two the console already holds in full. An enrolment or a foreign
 * relay has no name here and stays a short identifier, which is still better than a long one.
 */
export function buildNameDirectory(
  users: readonly UserView[],
  devices: readonly DeviceView[] = [],
): NameDirectory {
  const directory = new Map<string, string>();
  for (const user of users) {
    directory.set(user.id, user.username);
  }
  for (const device of devices) {
    directory.set(device.id, device.name);
  }
  return directory;
}

/** The head of an identifier: recognisable, and short enough to sit under a name. */
export function shortId(id: string): string {
  return id.length > SHORT_ID_LENGTH ? `${id.slice(0, SHORT_ID_LENGTH)}${ELLIPSIS}` : id;
}
