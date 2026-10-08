export function getOpenApiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Fuel System V2 REST API",
      version: "1.0.0",
      description:
        "Standardized JSON REST API for Fuel System V2 office, mobile attendant, and external integration operations.",
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
        ProblemDetails: {
          type: "object",
          description: "RFC 7807 compliant Problem Details error payload",
          properties: {
            type: {
              type: "string",
              format: "uri",
              example: "https://fuelsystem.erp/errors/INSUFFICIENT_STOCK",
            },
            title: { type: "string", example: "Insufficient Bulk Tank Stock" },
            status: { type: "integer", example: 422 },
            detail: {
              type: "string",
              example: "Tank balance is insufficient for requested fuel dispatch volume.",
            },
            instance: { type: "string", example: "/api/v1/fuel/issues" },
            code: { type: "string", example: "INSUFFICIENT_STOCK" },
            errors: {
              type: "object",
              additionalProperties: { type: "array", items: { type: "string" } },
            },
          },
          required: ["type", "title", "status", "detail", "code"],
        },
      },
    },
    paths: {
      "/auth/login": {
        post: {
          summary: "Authenticate using username and password",
          tags: ["Auth"],
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
            200: { description: "Logged in successfully, session JWT returned" },
            401: { description: "Invalid credentials" },
          },
        },
      },
      "/auth/logout": {
        post: {
          summary: "Log out current session",
          tags: ["Auth"],
          responses: { 200: { description: "Logged out" } },
        },
      },
      "/auth/me": {
        get: {
          summary: "Get currently authenticated user identity and role",
          tags: ["Auth"],
          responses: { 200: { description: "Current user profile" } },
        },
      },
      "/assets": {
        get: {
          summary: "List fleet assets with pagination and search",
          tags: ["Fleet"],
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "per_page", in: "query", schema: { type: "integer", default: 50 } },
            { name: "q", in: "query", schema: { type: "string" } },
            { name: "site", in: "query", schema: { type: "string" } },
            { name: "meterType", in: "query", schema: { type: "string", enum: ["KM", "HOURS"] } },
          ],
          responses: { 200: { description: "Paginated fleet assets" } },
        },
        post: {
          summary: "Create a new fleet asset (Admin only)",
          tags: ["Fleet"],
          responses: { 201: { description: "Created asset" } },
        },
      },
      "/assets/{code}": {
        get: {
          summary: "Get specific asset details",
          tags: ["Fleet"],
          parameters: [{ name: "code", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Asset details" } },
        },
        patch: {
          summary: "Update asset metadata (Admin only)",
          tags: ["Fleet"],
          parameters: [{ name: "code", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Updated asset" } },
        },
        delete: {
          summary: "Soft-delete asset (status DISPOSED)",
          tags: ["Fleet"],
          parameters: [{ name: "code", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Disposed asset" } },
        },
      },
      "/assets/{code}/fuel": {
        get: {
          summary: "Get fuel dispatches for asset",
          tags: ["Fleet"],
          parameters: [{ name: "code", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Fuel issues for asset" } },
        },
      },
      "/assets/{code}/services": {
        get: {
          summary: "Get service history records for asset",
          tags: ["Fleet"],
          parameters: [{ name: "code", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Service records for asset" } },
        },
      },
      "/assets/{code}/readings": {
        get: {
          summary: "Get meter readings for asset",
          tags: ["Fleet"],
          parameters: [{ name: "code", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Meter readings for asset" } },
        },
      },
      "/fuel/issues": {
        get: {
          summary: "List fuel issues across fleet",
          tags: ["Fuel"],
          parameters: [
            { name: "page", in: "query", schema: { type: "integer" } },
            { name: "per_page", in: "query", schema: { type: "integer" } },
            { name: "from", in: "query", schema: { type: "string" } },
            { name: "to", in: "query", schema: { type: "string" } },
            { name: "tankId", in: "query", schema: { type: "string" } },
          ],
          responses: { 200: { description: "List of fuel issues" } },
        },
        post: {
          summary: "Record fuel issue / dispatch (IssueFuelCommand)",
          tags: ["Fuel"],
          parameters: [
            {
              name: "X-Idempotency-Key",
              in: "header",
              required: false,
              schema: { type: "string" },
              description: "Unique idempotency key for replay-safe mutation (TX-02)",
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["assetIdOrCode", "fuelKind", "litres"],
                  properties: {
                    assetIdOrCode: { type: "string", example: "CAB-1001" },
                    fuelKind: { type: "string", example: "AUTO_DIESEL" },
                    litres: { type: "number", example: 45.0 },
                    bulkTankId: { type: "string", format: "uuid" },
                    projectId: { type: "string", format: "uuid" },
                    meterReading: { type: "number", example: 12450.5 },
                    driverName: { type: "string", example: "K. Perera" },
                    slipNumber: { type: "string", example: "SL-9941" },
                    notes: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: "Created fuel issue record" },
            400: {
              description: "Bad Request / Validation Error",
              content: { "application/problem+json": { schema: { $ref: "#/components/schemas/ProblemDetails" } } },
            },
            409: {
              description: "Idempotency key payload conflict",
              content: { "application/problem+json": { schema: { $ref: "#/components/schemas/ProblemDetails" } } },
            },
            422: {
              description: "Unprocessable Entity (Insufficient stock or non-positive volume)",
              content: { "application/problem+json": { schema: { $ref: "#/components/schemas/ProblemDetails" } } },
            },
          },
        },
      },
      "/fuel/issues/{id}/void": {
        post: {
          summary: "Void a fuel issue with audit explanation (VoidFuelIssueCommand)",
          tags: ["Fuel"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["reason"],
                  properties: {
                    reason: { type: "string", example: "Incorrect vehicle code entered at pump" },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: "Fuel issue successfully voided and stock restored" },
            404: {
              description: "Fuel issue not found",
              content: { "application/problem+json": { schema: { $ref: "#/components/schemas/ProblemDetails" } } },
            },
            422: {
              description: "Cannot void issue (Already voided or closed billing period)",
              content: { "application/problem+json": { schema: { $ref: "#/components/schemas/ProblemDetails" } } },
            },
          },
        },
      },
      "/fuel/requests": {
        get: {
          summary: "List fuel requests",
          tags: ["Fuel"],
          responses: { 200: { description: "List of requests" } },
        },
        post: {
          summary: "Submit a new fuel request",
          tags: ["Fuel"],
          responses: { 201: { description: "Submitted request" } },
        },
      },
      "/fuel/prices": {
        get: {
          summary: "Get national fuel price schedule",
          tags: ["Fuel"],
          responses: { 200: { description: "Fuel price schedule" } },
        },
        post: {
          summary: "Create or override fuel price entry (Admin only)",
          tags: ["Fuel"],
          responses: { 201: { description: "Created fuel price" } },
        },
      },
      "/tanks": {
        get: {
          summary: "List bulk storage tanks and reconciliation status",
          tags: ["Tanks"],
          responses: { 200: { description: "List of tanks" } },
        },
        post: {
          summary: "Create a bulk tank (Admin only)",
          tags: ["Tanks"],
          responses: { 201: { description: "Created bulk tank" } },
        },
      },
      "/tanks/{id}/dips": {
        get: {
          summary: "List physical dip measurements for tank",
          tags: ["Tanks"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Dips for tank" } },
        },
        post: {
          summary: "Record a physical dip for tank",
          tags: ["Tanks"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 201: { description: "Recorded tank dip" } },
        },
      },
      "/tanks/{id}/transfers/approve": {
        post: {
          summary: "Approve bulk fuel tank transfer request (ApproveTransferCommand)",
          tags: ["Tanks"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["transferRequestId"],
                  properties: {
                    transferRequestId: { type: "string", format: "uuid" },
                    notes: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: "Bulk transfer approved and stock updated" },
            403: {
              description: "Forbidden (Insufficient tank management authority)",
              content: { "application/problem+json": { schema: { $ref: "#/components/schemas/ProblemDetails" } } },
            },
            404: {
              description: "Transfer request or target tank not found",
              content: { "application/problem+json": { schema: { $ref: "#/components/schemas/ProblemDetails" } } },
            },
            422: {
              description: "Insufficient stock in source tank or invalid status",
              content: { "application/problem+json": { schema: { $ref: "#/components/schemas/ProblemDetails" } } },
            },
          },
        },
      },
      "/readings": {
        get: {
          summary: "List meter readings",
          tags: ["Readings & Conditions"],
          responses: { 200: { description: "Meter readings" } },
        },
        post: {
          summary: "Log a new meter reading",
          tags: ["Readings & Conditions"],
          responses: { 201: { description: "Logged meter reading" } },
        },
      },
      "/conditions": {
        get: {
          summary: "Get fleet daily working / breakdown condition",
          tags: ["Readings & Conditions"],
          parameters: [{ name: "day", in: "query", schema: { type: "string" } }],
          responses: { 200: { description: "Conditions for day" } },
        },
        post: {
          summary: "Record daily condition (WORKING / BREAKDOWN)",
          tags: ["Readings & Conditions"],
          responses: { 200: { description: "Saved condition" } },
        },
      },
      "/services": {
        get: {
          summary: "List service records",
          tags: ["Services"],
          responses: { 200: { description: "Service records" } },
        },
        post: {
          summary: "Log a new service record",
          tags: ["Services"],
          responses: { 201: { description: "Created service record" } },
        },
      },
      "/bills": {
        get: {
          summary: "List billing invoices",
          tags: ["Billing"],
          parameters: [
            { name: "ym", in: "query", schema: { type: "string" } },
            { name: "status", in: "query", schema: { type: "string" } },
          ],
          responses: { 200: { description: "List of bills" } },
        },
      },
      "/bills/{id}": {
        get: {
          summary: "Get single billing invoice details and line items",
          tags: ["Billing"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Invoice details" } },
        },
      },
      "/aging": {
        get: {
          summary: "Get receivables aging report",
          tags: ["Billing"],
          responses: { 200: { description: "Aging report buckets" } },
        },
      },
      "/bills/generate": {
        post: {
          summary: "Generate or regenerate all bills for a month (Admin only)",
          tags: ["Billing"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["year", "month"],
                  properties: {
                    year: { type: "integer", example: 2026 },
                    month: { type: "integer", example: 8 },
                    regenerate: { type: "boolean" },
                    basis: { type: "string", enum: ["fw", "w", "d"] },
                  },
                },
              },
            },
          },
          responses: { 200: { description: "Generation outcome summary" } },
        },
      },
      "/bills/{id}/issue": {
        post: {
          summary: "Issue a draft bill into a formal invoice (IssueInvoiceCommand)",
          tags: ["Billing"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            200: { description: "Invoice successfully issued and finalized" },
            403: {
              description: "Forbidden (Insufficient billing authority)",
              content: { "application/problem+json": { schema: { $ref: "#/components/schemas/ProblemDetails" } } },
            },
            404: {
              description: "Bill draft not found",
              content: { "application/problem+json": { schema: { $ref: "#/components/schemas/ProblemDetails" } } },
            },
            409: {
              description: "Bill is already in ISSUED or PAID status",
              content: { "application/problem+json": { schema: { $ref: "#/components/schemas/ProblemDetails" } } },
            },
          },
        },
      },
      "/bills/{id}/payments": {
        get: {
          summary: "List payments received against an invoice",
          tags: ["Billing"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Payments list" } },
        },
        post: {
          summary: "Record payment against an invoice (Admin only)",
          tags: ["Billing"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Payment recorded" } },
        },
      },
      "/bills/{id}/revisions": {
        get: {
          summary: "Get revision history for an invoice",
          tags: ["Billing"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Revisions list" } },
        },
      },
      "/bills/{id}/credit-notes": {
        get: {
          summary: "List credit notes for an invoice",
          tags: ["Billing"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Credit notes list" } },
        },
        post: {
          summary: "Draft a credit note against an invoice (Admin only)",
          tags: ["Billing"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 201: { description: "Credit note drafted" } },
        },
      },
      "/webhooks": {
        get: {
          summary: "List configured webhooks (Admin only)",
          tags: ["Webhooks"],
          responses: { 200: { description: "List of webhooks" } },
        },
        post: {
          summary: "Register a webhook endpoint (Admin only)",
          tags: ["Webhooks"],
          responses: { 201: { description: "Webhook registered" } },
        },
      },
      "/webhooks/{id}": {
        delete: {
          summary: "Delete a webhook endpoint (Admin only)",
          tags: ["Webhooks"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Webhook deleted" } },
        },
      },
      "/webhooks/test": {
        post: {
          summary: "Trigger test webhook ping (Admin only)",
          tags: ["Webhooks"],
          responses: { 200: { description: "Test ping sent" } },
        },
      },
      "/reports/fleet": {
        get: {
          summary: "Fleet utilization and consumption report",
          tags: ["Reports"],
          responses: { 200: { description: "Fleet report metrics" } },
        },
      },
      "/reports/sites": {
        get: {
          summary: "Site-wise fuel and billing overview",
          tags: ["Reports"],
          responses: { 200: { description: "Site overview" } },
        },
      },
      "/api-keys": {
        get: {
          summary: "List issued API keys (Admin only)",
          tags: ["Admin / API Keys"],
          responses: { 200: { description: "List of active API keys" } },
        },
        post: {
          summary: "Issue a new API key (Admin only)",
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
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "API key revoked" } },
        },
      },
      "/meter-outages": {
        get: {
          summary: "List meter outages with filters and pagination",
          tags: ["Meter Outages"],
          parameters: [
            { name: "assetId", in: "query", schema: { type: "string" } },
            { name: "status", in: "query", schema: { type: "string", enum: ["open", "closed", "all"] } },
            { name: "from", in: "query", schema: { type: "string", format: "date" } },
            { name: "to", in: "query", schema: { type: "string", format: "date" } },
            { name: "page", in: "query", schema: { type: "integer" } },
            { name: "perPage", in: "query", schema: { type: "integer" } },
          ],
          responses: { 200: { description: "Paginated list of meter outages" } },
        },
        post: {
          summary: "Open a new meter outage for an asset",
          tags: ["Meter Outages"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["assetId", "reason"],
                  properties: {
                    assetId: { type: "string" },
                    startDate: { type: "string", format: "date" },
                    reason: { type: "string" },
                    notes: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: "Meter outage opened" },
            409: { description: "Asset already has an active meter outage" },
          },
        },
      },
      "/meter-outages/{id}": {
        get: {
          summary: "Get meter outage by ID",
          tags: ["Meter Outages"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Meter outage details" }, 404: { description: "Not found" } },
        },
        patch: {
          summary: "Edit meter outage details (Admin only)",
          tags: ["Meter Outages"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    startDate: { type: "string", format: "date" },
                    reason: { type: "string" },
                    notes: { type: "string" },
                    resolutionNotes: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { 200: { description: "Updated outage details" }, 403: { description: "Admin required" } },
        },
        delete: {
          summary: "Cancel and delete meter outage (Admin only)",
          tags: ["Meter Outages"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Outage deleted" }, 403: { description: "Admin required" } },
        },
      },
      "/meter-outages/{id}/close": {
        patch: {
          summary: "Close an active meter outage and record resume reading",
          tags: ["Meter Outages"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["resolution", "resumeReading"],
                  properties: {
                    endDate: { type: "string", format: "date" },
                    resolution: { type: "string", enum: ["repaired", "replaced"] },
                    resumeReading: { type: "number" },
                    resolutionNotes: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: "Outage closed and resumption reading created" },
            400: { description: "Outage already closed or invalid reading" },
          },
        },
      },
    },
  };
}
