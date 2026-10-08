// API Contracts & Error Specifications Test Suite (Task API-01 / Wave D)
//
// Verifies:
// 1. OpenAPI 3.1.0 specification compliance and completeness.
// 2. RFC 7807 Problem Details schema in components.schemas.
// 3. Core command routes in OpenAPI: IssueFuel, VoidFuelIssue, ApproveTransfer, IssueInvoice.
// 4. problem() response utility outputs valid application/problem+json.
// 5. ASP.NET Core (.NET 10 LTS) project skeleton and modular monolith layout.
// 6. ADR 0003 documentation completeness.

import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { getOpenApiSpec } from "../src/lib/api/openapi";
import { problem } from "../src/lib/api/respond";

describe("API-01: OpenAPI 3.1 Specification & ProblemDetails Schema", () => {
  const spec = getOpenApiSpec();

  it("verifies OpenAPI 3.1.0 root metadata and servers", () => {
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toContain("Fuel System V2");
    expect(spec.servers[0].url).toBe("/api/v1");
  });

  it("defines RFC 7807 ProblemDetails in components.schemas", () => {
    const schemas = spec.components?.schemas as Record<string, any>;
    expect(schemas).toBeDefined();
    expect(schemas.ProblemDetails).toBeDefined();

    const problemSchema = schemas.ProblemDetails;
    expect(problemSchema.type).toBe("object");
    expect(problemSchema.required).toContain("type");
    expect(problemSchema.required).toContain("title");
    expect(problemSchema.required).toContain("status");
    expect(problemSchema.required).toContain("detail");
    expect(problemSchema.required).toContain("code");

    expect(problemSchema.properties.type.format).toBe("uri");
    expect(problemSchema.properties.status.type).toBe("integer");
  });

  it("documents IssueFuelCommand with X-Idempotency-Key and RFC 7807 responses", () => {
    const paths = spec.paths as Record<string, any>;
    const issuePath = paths["/fuel/issues"];
    expect(issuePath).toBeDefined();
    expect(issuePath.post).toBeDefined();

    const post = issuePath.post;
    expect(post.summary).toContain("IssueFuelCommand");

    // Idempotency header
    const headers = post.parameters?.filter((p: any) => p.in === "header");
    expect(headers?.some((h: any) => h.name === "X-Idempotency-Key")).toBe(true);

    // Request body
    const bodyProps = post.requestBody?.content?.["application/json"]?.schema?.properties;
    expect(bodyProps).toBeDefined();
    expect(bodyProps.assetIdOrCode).toBeDefined();
    expect(bodyProps.litres).toBeDefined();
    expect(bodyProps.fuelKind).toBeDefined();

    // Responses
    expect(post.responses["201"]).toBeDefined();
    expect(post.responses["400"]).toBeDefined();
    expect(post.responses["409"]).toBeDefined();
    expect(post.responses["422"]).toBeDefined();
  });

  it("documents VoidFuelIssueCommand with reason and RFC 7807 responses", () => {
    const paths = spec.paths as Record<string, any>;
    const voidPath = paths["/fuel/issues/{id}/void"];
    expect(voidPath).toBeDefined();
    expect(voidPath.post).toBeDefined();

    const post = voidPath.post;
    expect(post.summary).toContain("VoidFuelIssueCommand");

    const reqBodyProps = post.requestBody?.content?.["application/json"]?.schema?.properties;
    expect(reqBodyProps.reason).toBeDefined();

    expect(post.responses["200"]).toBeDefined();
    expect(post.responses["404"]).toBeDefined();
    expect(post.responses["422"]).toBeDefined();
  });

  it("documents ApproveTransferCommand under /tanks/{id}/transfers/approve", () => {
    const paths = spec.paths as Record<string, any>;
    const transferPath = paths["/tanks/{id}/transfers/approve"];
    expect(transferPath).toBeDefined();
    expect(transferPath.post).toBeDefined();

    const post = transferPath.post;
    expect(post.summary).toContain("ApproveTransferCommand");

    const reqProps = post.requestBody?.content?.["application/json"]?.schema?.properties;
    expect(reqProps.transferRequestId).toBeDefined();

    expect(post.responses["200"]).toBeDefined();
    expect(post.responses["403"]).toBeDefined();
    expect(post.responses["422"]).toBeDefined();
  });

  it("documents IssueInvoiceCommand under /bills/{id}/issue", () => {
    const paths = spec.paths as Record<string, any>;
    const billPath = paths["/bills/{id}/issue"];
    expect(billPath).toBeDefined();
    expect(billPath.post).toBeDefined();

    const post = billPath.post;
    expect(post.summary).toContain("IssueInvoiceCommand");

    expect(post.responses["200"]).toBeDefined();
    expect(post.responses["403"]).toBeDefined();
    expect(post.responses["404"]).toBeDefined();
    expect(post.responses["409"]).toBeDefined();
  });
});

describe("API-01: TypeScript RFC 7807 Response Helper", () => {
  it("generates compliant application/problem+json response", async () => {
    const res = problem(
      422,
      "Insufficient Bulk Tank Stock",
      "Tank balance is 40.0L, but 50.0L was requested.",
      "INSUFFICIENT_STOCK",
      "/api/v1/fuel/issues",
      { remainingBalance: 40.0 }
    );

    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toBe("application/problem+json");

    const body = await res.json();
    expect(body.type).toBe("https://fuelsystem.erp/errors/INSUFFICIENT_STOCK");
    expect(body.title).toBe("Insufficient Bulk Tank Stock");
    expect(body.status).toBe(422);
    expect(body.detail).toBe("Tank balance is 40.0L, but 50.0L was requested.");
    expect(body.code).toBe("INSUFFICIENT_STOCK");
    expect(body.instance).toBe("/api/v1/fuel/issues");
    expect(body.remainingBalance).toBe(40.0);
  });
});

describe("API-01: .NET API Composition Root & Modular Monolith Layout", () => {
  const rootDir = path.resolve(__dirname, "..");
  const apiDir = path.join(rootDir, "apps", "api");
  const modulesDir = path.join(rootDir, "src", "Modules");
  const adrPath = path.join(
    rootDir,
    "docs",
    "adr",
    "0003-dotnet-api-skeleton-and-error-contracts.md"
  );

  it("verifies ADR 0003 exists and details required architectural decisions", () => {
    expect(fs.existsSync(adrPath)).toBe(true);
    const adr = fs.readFileSync(adrPath, "utf-8");
    expect(adr).toContain("ADR 0003: .NET API Skeleton");
    expect(adr).toContain("ASP.NET Core (.NET 10 LTS)");
    expect(adr).toContain("RFC 7807");
    expect(adr).toContain("DOM-01");
  });

  it("verifies FuelSystem.Api.csproj targets net10.0 with Npgsql and OpenAPI", () => {
    const csprojPath = path.join(apiDir, "FuelSystem.Api.csproj");
    expect(fs.existsSync(csprojPath)).toBe(true);
    const csproj = fs.readFileSync(csprojPath, "utf-8");
    expect(csproj).toContain("<TargetFramework>net10.0</TargetFramework>");
    expect(csproj).toContain("Npgsql.EntityFrameworkCore.PostgreSQL");
    expect(csproj).toContain("Microsoft.AspNetCore.OpenApi");
    expect(csproj).toContain("Scalar.AspNetCore");
  });

  it("verifies Program.cs registers ProblemDetails and OpenAPI", () => {
    const programPath = path.join(apiDir, "Program.cs");
    expect(fs.existsSync(programPath)).toBe(true);
    const program = fs.readFileSync(programPath, "utf-8");
    expect(program).toContain("builder.Services.AddProblemDetails(");
    expect(program).toContain("builder.Services.AddOpenApi(");
    expect(program).toContain("FuelEndpoints.Map");
    expect(program).toContain("BillingEndpoints.Map");
  });

  it("verifies appsettings.json configures PostgreSQL and CORS", () => {
    const settingsPath = path.join(apiDir, "appsettings.json");
    expect(fs.existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(settings.ConnectionStrings?.DefaultConnection).toContain("fuelsystem_app");
    expect(settings.Cors?.AllowedOrigins).toContain("http://localhost:3000");
  });

  it("verifies modular domain slices exist in src/Modules/", () => {
    expect(fs.existsSync(path.join(modulesDir, "Common", "ProblemDetailsExtensions.cs"))).toBe(true);
    expect(fs.existsSync(path.join(modulesDir, "Fuel", "FuelEndpoints.cs"))).toBe(true);
    expect(fs.existsSync(path.join(modulesDir, "Billing", "BillingEndpoints.cs"))).toBe(true);
  });
});
