// Caught values are typed `unknown` — TypeScript cannot know what a thrown
// value is, and `any` silently allows `err.message` on a thrown string or a
// Prisma error object that has no `message`. This narrows once, in one place,
// so server actions can keep surfacing a readable line to the operator.

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(err);
}

// Same narrowing, but falls back to a caller-supplied line when the thrown
// value carries no usable message — preserves the `err?.message || "…"`
// behaviour without printing "undefined" at the operator.
export function errorMessageOr(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === "string" && m) return m;
  }
  return fallback;
}
