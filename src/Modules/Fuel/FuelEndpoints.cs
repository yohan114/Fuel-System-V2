using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using FuelSystem.Modules.Common;

namespace FuelSystem.Modules.Fuel;

public record IssueFuelRequest(
    string AssetIdOrCode,
    string FuelKind,
    decimal Litres,
    string? BulkTankId,
    string? ProjectId,
    decimal? MeterReading,
    string? DriverName,
    string? SlipNumber,
    string? Notes,
    string? SourceType
);

public record IssueFuelResponse(
    string IssueId,
    string AssetCode,
    decimal Litres,
    decimal UnitPrice,
    decimal TotalCost,
    decimal RemainingTankBalance,
    string EffectiveDate
);

public record VoidFuelIssueRequest(
    string Reason
);

public record VoidFuelIssueResponse(
    string IssueId,
    string Status,
    decimal RestoredLitres,
    string VoidedAt
);

public static class FuelEndpoints
{
    public static void Map(RouteGroupBuilder group)
    {
        var fuel = group.MapGroup("/fuel").WithTags("Fuel Operations");

        // POST /api/v1/fuel/issues (IssueFuelCommand)
        fuel.MapPost("/issues", (IssueFuelRequest request, HttpContext context) =>
        {
            if (request.Litres <= 0)
            {
                var problem = ProblemDetailsExtensions.CreateBusinessProblem(
                    StatusCodes.Status422UnprocessableEntity,
                    "Invalid Fuel Quantity",
                    "Fuel quantity must be strictly greater than zero.",
                    "INVALID_QUANTITY",
                    context.Request.Path
                );
                return Results.Problem(problem);
            }

            // Command execution stub matching DOM-01 contract
            var response = new IssueFuelResponse(
                IssueId: Guid.NewGuid().ToString(),
                AssetCode: request.AssetIdOrCode,
                Litres: request.Litres,
                UnitPrice: 382.00m,
                TotalCost: request.Litres * 382.00m,
                RemainingTankBalance: 1250.00m,
                EffectiveDate: DateTimeOffset.UtcNow.ToString("O")
            );

            return Results.Created($"/api/v1/fuel/issues/{response.IssueId}", response);
        })
        .WithName("IssueFuel")
        .Produces<IssueFuelResponse>(StatusCodes.Status201Created)
        .ProducesProblem(StatusCodes.Status400BadRequest)
        .ProducesProblem(StatusCodes.Status422UnprocessableEntity);

        // POST /api/v1/fuel/issues/{id}/void (VoidFuelIssueCommand)
        fuel.MapPost("/issues/{id}/void", (string id, VoidFuelIssueRequest request, HttpContext context) =>
        {
            if (string.IsNullOrWhiteSpace(request.Reason))
            {
                var problem = ProblemDetailsExtensions.CreateBusinessProblem(
                    StatusCodes.Status422UnprocessableEntity,
                    "Void Reason Required",
                    "A valid business justification is mandatory to void an issued transaction.",
                    "VOID_REASON_REQUIRED",
                    context.Request.Path
                );
                return Results.Problem(problem);
            }

            var response = new VoidFuelIssueResponse(
                IssueId: id,
                Status: "VOID",
                RestoredLitres: 45.0m,
                VoidedAt: DateTimeOffset.UtcNow.ToString("O")
            );

            return Results.Ok(response);
        })
        .WithName("VoidFuelIssue")
        .Produces<VoidFuelIssueResponse>(StatusCodes.Status200OK)
        .ProducesProblem(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status422UnprocessableEntity);
    }
}
