import { NextResponse } from "next/server";

export interface ApiSuccessResponse<T> {
  ok: true;
  data: T;
  meta?: Record<string, any>;
}

export interface ApiErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function ok<T>(data: T, meta?: Record<string, any>, status = 200) {
  const body: ApiSuccessResponse<T> = { ok: true, data };
  if (meta) body.meta = meta;
  return NextResponse.json(body, { status });
}

export function err(code: string, message: string, status = 400, details?: unknown) {
  const body: ApiErrorResponse = {
    ok: false,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
  return NextResponse.json(body, { status });
}
