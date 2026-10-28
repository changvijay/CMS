export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** True for the errors Google returns when the saved token lacks a permission, which only re-authorizing the channel fixes. */
export function isPermissionError(error: { code: number; reason?: string }): boolean {
  return error.code === 401 || error.code === 403 || error.reason === 'unauthorized' || error.reason === 'forbidden';
}

/** Same check for an error that already became a message, like "YouTube error 403 [insufficientPermissions]: ...". */
export function isPermissionMessage(message: string): boolean {
  return /\berror (401|403)\b|insufficientPermissions|unauthorized|forbidden/i.test(message);
}
