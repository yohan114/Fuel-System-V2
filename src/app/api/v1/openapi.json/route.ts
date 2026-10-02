import { NextResponse } from "next/server";
import { getOpenApiSpec } from "@/lib/api/openapi";

export async function GET() {
  const spec = getOpenApiSpec();

  return NextResponse.json(spec, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
