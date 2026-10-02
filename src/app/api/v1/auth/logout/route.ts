import { deleteSession } from "@/lib/auth";
import { ok } from "@/lib/api/respond";

export async function POST() {
  await deleteSession();
  return ok({ message: "Logged out successfully" });
}
