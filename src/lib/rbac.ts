import { requireUser } from "./auth";

const MATRIX = {
  ADMIN: new Set(["create", "update", "delete", "approve", "manage", "allocate"]),
  ALLOCATOR: new Set(["allocate"]),
  USER: new Set(["create"]),
  WORKSHOP: new Set(["create"]),
};

export type RBACAction = "create" | "update" | "delete" | "approve" | "manage" | "allocate";

export async function assertCan(action: RBACAction) {
  const user = await requireUser();
  const roleActions = MATRIX[user.role as keyof typeof MATRIX];
  if (!roleActions || !roleActions.has(action)) {
    throw new Error("FORBIDDEN");
  }
  return user;
}
