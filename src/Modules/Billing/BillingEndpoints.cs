using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using FuelSystem.Modules.Common;

namespace FuelSystem.Modules.Billing;

public record IssueInvoiceResponse(
    string BillId,
    string InvoiceNumber,
    string Status,
    decimal TotalAmount,
    string IssuedAt
);

public static class BillingEndpoints
{
    public static void Map(RouteGroupBuilder group)
    {
        var billing = group.MapGroup("/bills").WithTags("Billing Operations");

        // POST /api/v1/bills/{id}/issue (IssueInvoiceCommand)
        billing.MapPost("/{id}/issue", (string id, HttpContext context) =>
        {
            var response = new IssueInvoiceResponse(
                BillId: id,
                InvoiceNumber: "INV-2026-08-0042",
                Status: "ISSUED",
                TotalAmount: 182514.50m,
                IssuedAt: DateTimeOffset.UtcNow.ToString("O")
            );

            return Results.Ok(response);
        })
        .WithName("IssueInvoice")
        .Produces<IssueInvoiceResponse>(StatusCodes.Status200OK)
        .ProducesProblem(StatusCodes.Status403Forbidden)
        .ProducesProblem(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict);
    }
}
