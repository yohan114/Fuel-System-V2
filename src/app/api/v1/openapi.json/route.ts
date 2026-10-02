import { NextResponse } from "next/server";

export async function GET() {
  const spec = {
    openapi: "3.1.0",
    info: {
      title: "Fuel System V2 REST API",
      version: "1.0.0",
      description: "Standardized JSON REST API for Fuel System V2 office, mobile attendant, and external integration operations.",
      contact: {
        name: "Engineering Support",
      },
    },
    servers: [
      {
        url: "/api/v1",
        description: "Current environment API v1",
      },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT or fs_live_* API Key",
          description: "Supply either an issued API key (`fs_live_...`) or JWT session token.",
        },
        CookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "session",
          description: "Standard browser session cookie.",
        },
      },
      schemas: {
        StandardSuccess: {
          type: "object",
          properties: {
            ok: { type: "boolean", example: true },
            data: { type: "object" },
            meta: { type: "object" },
          },
          required: ["ok", "data"],
        },
        StandardError: {
          type: "object",
          properties: {
            ok: { type: "boolean", example: false },
            error: {
              type: "object",
              properties: {
                code: { type: "string", example: "VALIDATION_ERROR" },
                message: { type: "string", example: "Invalid input provided" },
                details: { type: "object" },
              },
              required: ["code", "message"],
            },
          },
          required: ["ok", "error"],
        },
      },
    },
    security: [
      { BearerAuth: [] },
      { CookieAuth: [] },
    ],
    paths: {
      "/auth/login": {
        post: {
          summary: "Authenticate user and receive token / session",
          tags: ["Auth"],
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["username", "password"],
                  properties: {
                    username: { type: "string" },
                    password: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: "Successful login with token and user object" },
            401: { description: "Invalid credentials" },
            429: { description: "Rate limit exceeded" },
          },
        },
      },
      "/auth/logout": {
        post: {
          summary: "Clear session",
          tags: ["Auth"],
          responses: {
            200: { description: "Logged out" },
          },
        },
      },
      "/auth/me": {
        get: {
          summary: "Get current user and auth context",
          tags: ["Auth"],
          responses: {
            200: { description: "Current user and authentication details" },
            401: { description: "Unauthorized" },
          },
        },
      },
      "/auth/change-password": {
        post: {
          summary: "Change password for currently authenticated user",
          tags: ["Auth"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["currentPassword", "newPassword"],
                  properties: {
                    currentPassword: { type: "string" },
                    newPassword: { type: "string", minLength: 6 },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: "Password changed successfully" },
            400: { description: "Invalid current password or validation error" },
          },
        },
      },
      "/api-keys": {
        get: {
          summary: "List all API keys (Admin only)",
          tags: ["Admin / API Keys"],
          responses: {
            200: { description: "List of API keys" },
            403: { description: "Forbidden" },
          },
        },
        post: {
          summary: "Create a new API key (Admin only)",
          tags: ["Admin / API Keys"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name"],
                  properties: {
                    name: { type: "string" },
                    scopes: { type: "string", default: "*" },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: "API key created. Raw secret returned once." },
            403: { description: "Forbidden" },
          },
        },
      },
      "/api-keys/{id}": {
        delete: {
          summary: "Revoke an API key (Admin only)",
          tags: ["Admin / API Keys"],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            200: { description: "API key revoked" },
            404: { description: "API key not found" },
          },
        },
      },
    },
  };

  return NextResponse.json(spec, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
