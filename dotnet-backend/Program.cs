using UniversalDocument.Api.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<HostOptions>(options =>
{
    options.StartupTimeout = TimeSpan.FromMinutes(10);
});

builder.Services.AddOpenApi();
builder.Services.AddControllers();

builder.Services.AddCors(options =>
{
    options.AddPolicy("Frontend", policy =>
    {
        policy
            .WithOrigins(
                "http://localhost:5173",
                "http://127.0.0.1:5173")
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

builder.Services.AddSingleton<OcrWorkerService>();
builder.Services.AddHostedService(
    services => services.GetRequiredService<OcrWorkerService>());

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors("Frontend");
app.MapControllers();

app.MapGet("/health", (OcrWorkerService worker) =>
{
    var ready = worker.IsReady;

    return Results.Json(new
    {
        status = ready ? "healthy" : "unavailable",
        service = "universal-document-api",
        version = "0.2.0",
        ocr_worker = ready ? "ready" : "unavailable"
    }, statusCode: ready
        ? StatusCodes.Status200OK
        : StatusCodes.Status503ServiceUnavailable);
});

app.Run();
