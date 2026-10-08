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

export interface Rfc7807ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  code: string;
  errors?: Record<string, string[]>;
  [key: string]: unknown;
}

/**
 * Returns a standardized RFC 7807 (application/problem+json) response.
 * Standard across ASP.NET Core (.NET 10 LTS) and modern Enterprise ERP APIs.
 */
export function problem(
  status: number,
  title: string,
  detail: string,
  code: string,
  instance?: string,
  extensions?: Record<string, unknown>
) {
  const body: Rfc7807ProblemDetails = {
    type: `https://fuelsystem.erp/errors/${code}`,
    title,
    status,
    detail,
    code,
    ...(instance ? { instance } : {}),
    ...(extensions || {}),
  };

  return NextResponse.json(body, {
    status,
    headers: {
      "Content-Type": "application/problem+json",
    },
  });
}

