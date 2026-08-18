export const DEV_FALLBACK_SECRET = "default_auth_secret_must_be_changed_in_env_file";

// Pure resolution of the JWT signing secret. Production refuses to run on the
// known fallback (unset or explicitly set to it); development falls back so
// local setups keep working.
export function resolveAuthSecret(
  configured: string | undefined,
  nodeEnv: string | undefined
): { secret: string; usedFallback: boolean } {
  if (configured && configured !== DEV_FALLBACK_SECRET) {
    return { secret: configured, usedFallback: false };
  }
  if (nodeEnv === "production") {
    throw new Error(
      configured
        ? "AUTH_SECRET is set to the known development default. Set it to a long random value before running in production."
        : "AUTH_SECRET is not set. Refusing to sign or verify sessions in production — set AUTH_SECRET to a long random value."
    );
  }
  return { secret: DEV_FALLBACK_SECRET, usedFallback: true };
}
