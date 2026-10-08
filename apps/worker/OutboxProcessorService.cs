using System;
using System.Data;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace FuelSystem.Worker;

public class OutboxProcessorService : BackgroundService
{
    private readonly ILogger<OutboxProcessorService> _logger;
    private readonly IConfiguration _configuration;
    private readonly string _connectionString;
    private readonly int _pollingIntervalSeconds;
    private readonly int _batchSize;
    private readonly int _maxRetries;

    public OutboxProcessorService(
        ILogger<OutboxProcessorService> logger,
        IConfiguration configuration)
    {
        _logger = logger;
        _configuration = configuration;
        _connectionString = _configuration.GetConnectionString("DefaultConnection") 
            ?? "Host=localhost;Database=fuelsystem;Username=fuelsystem_app;";
        _pollingIntervalSeconds = _configuration.GetValue<int>("OutboxWorker:PollingIntervalSeconds", 2);
        _batchSize = _configuration.GetValue<int>("OutboxWorker:BatchSize", 50);
        _maxRetries = _configuration.GetValue<int>("OutboxWorker:MaxRetries", 5);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("OutboxProcessorService started with {Interval}s polling interval, batch size {BatchSize}, max retries {MaxRetries}.",
            _pollingIntervalSeconds, _batchSize, _maxRetries);

        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(_pollingIntervalSeconds));

        while (!stoppingToken.IsCancellationRequested && await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await ProcessBatchAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Unhandled error during outbox processing cycle.");
            }
        }

        _logger.LogInformation("OutboxProcessorService gracefully stopped.");
    }

    public async Task<int> ProcessBatchAsync(CancellationToken cancellationToken)
    {
        // Continuous polling query with row-level locking (FOR UPDATE SKIP LOCKED) to allow multiple concurrent worker replicas
        const string query = @"
            SELECT id, event_type, aggregate_type, aggregate_id, payload_json, retry_count
            FROM outbox_messages
            WHERE processed_at IS NULL AND retry_count < @maxRetries
            ORDER BY created_at ASC
            LIMIT @batchSize
            FOR UPDATE SKIP LOCKED;";

        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);

        await using var tx = await conn.BeginTransactionAsync(cancellationToken);
        await using var cmd = new NpgsqlCommand(query, conn, tx);
        cmd.Parameters.AddWithValue("maxRetries", _maxRetries);
        cmd.Parameters.AddWithValue("batchSize", _batchSize);

        var processedCount = 0;
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);

        while (await reader.ReadAsync(cancellationToken))
        {
            var messageId = reader.GetGuid(0);
            var eventType = reader.GetString(1);
            var aggregateType = reader.GetString(2);
            var aggregateId = reader.GetString(3);
            var payloadJson = reader.GetString(4);
            var retryCount = reader.GetInt32(5);

            _logger.LogInformation("Processing outbox message {MessageId} of type {EventType} for {AggregateType}:{AggregateId} (Attempt {Attempt})",
                messageId, eventType, aggregateType, aggregateId, retryCount + 1);

            processedCount++;
        }

        await reader.CloseAsync();
        await tx.CommitAsync(cancellationToken);

        return processedCount;
    }
}
