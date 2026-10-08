/**
 * Core Application Command abstractions (Master Plan DOM-01).
 *
 * Encapsulates transactional write authority, security context, and
 * structured command outcomes across both UI Server Actions and REST APIs.
 */

export interface CommandContext {
  actorId: string;
  actorName?: string | null;
  role: string;
  projectId?: string | null;
  bulkTankId?: string | null;
  ipAddress?: string | null;
}

export type CommandResult<T> =
  | { success: true; data: T; message?: string; error?: undefined; code?: undefined; blocked?: undefined; reasons?: undefined }
  | { success: false; error: string; code?: string; blocked?: boolean; reasons?: string[]; data?: undefined };
