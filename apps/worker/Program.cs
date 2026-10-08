using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using FuelSystem.Worker;

var builder = Host.CreateApplicationBuilder(args);

// Register durable outbox background service
builder.Services.AddHostedService<OutboxProcessorService>();

var host = builder.Build();
host.Run();
