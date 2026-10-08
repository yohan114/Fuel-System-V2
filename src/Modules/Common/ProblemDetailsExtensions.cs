using Microsoft.AspNetCore.Mvc;

namespace FuelSystem.Modules.Common;

/// <summary>
/// RFC 7807 Problem Details factory extensions for ERP business errors.
/// </summary>
public static class ProblemDetailsExtensions
{
    public static ProblemDetails CreateBusinessProblem(
        int statusCode,
        string title,
        string detail,
        string errorCode,
        string? instance = null,
        IDictionary<string, object?>? extensions = null)
    {
        var problem = new ProblemDetails
        {
            Type = $"https://fuelsystem.erp/errors/{errorCode}",
            Title = title,
            Status = statusCode,
            Detail = detail,
            Instance = instance
        };

        problem.Extensions["code"] = errorCode;

        if (extensions != null)
        {
            foreach (var (key, value) in extensions)
            {
                problem.Extensions[key] = value;
            }
        }

        return problem;
    }
}
