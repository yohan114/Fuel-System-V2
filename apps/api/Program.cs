using System.Net.Mime;
using System.Text.Json;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;

var builder = WebApplication.CreateBuilder(args);

// ----------------------------------------------------------------------------
// 1. Service Registrations & Middleware Configuration
// ----------------------------------------------------------------------------

// Standard RFC 7807 Problem Details for all API errors
builder.Services.AddProblemDetails(options =>
{
    options.CustomizeProblemDetails = ctx =>
    {
        ctx.ProblemDetails.Instance = $"{ctx.HttpContext.Request.Method} {ctx.HttpContext.Request.Path}";
        ctx.ProblemDetails.Extensions["traceId"] = ctx.HttpContext.TraceIdentifier;
    };
});

// OpenAPI 3.1 & Endpoints API Explorer
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddOpenApi(options =>
{
    options.AddDocumentTransformer((document, context, ct) =>
    {
        document.Info.Title = "Fuel System V2 Enterprise ERP API";
        document.Info.Version = "v1";
        document.Info.Description = "Modular monolith ERP backend for fleet, bulk fuel tracking, and billing operations.";
        return Task.CompletedTask;
    });
});

// CORS policy for Next.js web application
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        var origins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() 
            ?? new[] { "http://localhost:3000" };
        policy.WithOrigins(origins)
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

// Health Checks
builder.Services.AddHealthChecks();

var app = builder.Build();

// ----------------------------------------------------------------------------
// 2. HTTP Request Pipeline
// ----------------------------------------------------------------------------

// Handle unhandled exceptions as standard RFC 7807 ProblemDetails
app.UseExceptionHandler();
app.UseStatusCodePages();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors();

// ----------------------------------------------------------------------------
// 3. Health & Diagnostic Endpoints
// ----------------------------------------------------------------------------

app.MapHealthChecks("/healthz");

app.MapGet("/api/v1/health", () => Results.Ok(new
{
    status = "healthy",
    engine = "ASP.NET Core (.NET 10 LTS)",
    version = "2.0.0",
    timestamp = DateTimeOffset.UtcNow
}))
.WithName("GetHealth")
.WithTags("System");

// ----------------------------------------------------------------------------
// 4. Command Endpoints (Mapped to Vertical Modules)
// ----------------------------------------------------------------------------

var v1 = app.MapGroup("/api/v1");

// Fuel Domain
FuelSystem.Modules.Fuel.FuelEndpoints.Map(v1);

// Billing Domain
FuelSystem.Modules.Billing.BillingEndpoints.Map(v1);

app.Run();
