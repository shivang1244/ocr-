using System.Diagnostics;
using System.Text.Json;

namespace UniversalDocument.Api.Services;

public sealed class OcrWorkerService : IHostedService, IDisposable
{
    private readonly IConfiguration _configuration;
    private readonly ILogger<OcrWorkerService> _logger;
    private readonly IWebHostEnvironment _environment;
    private readonly SemaphoreSlim _requestLock = new(1, 1);

    private Process? _process;
    private Task? _stderrPump;
    private volatile bool _isReady;

    public OcrWorkerService(
        IConfiguration configuration,
        ILogger<OcrWorkerService> logger,
        IWebHostEnvironment environment)
    {
        _configuration = configuration;
        _logger = logger;
        _environment = environment;
    }

    public bool IsReady =>
        _isReady &&
        _process is { HasExited: false };

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        var settings = _configuration.GetSection("OcrWorker");

        var workingDirectory = ResolvePath(
            settings["WorkingDirectory"] ?? "../backend");

        var pythonExecutable = ResolvePath(
            settings["PythonExecutable"] ?? "../.venv/Scripts/python.exe");

        var startupTimeoutMinutes = settings.GetValue(
            "StartupTimeoutMinutes", 10);

        if (!Directory.Exists(workingDirectory))
        {
            throw new DirectoryNotFoundException(
                $"Python worker directory was not found: {workingDirectory}");
        }

        if (!File.Exists(pythonExecutable))
        {
            throw new FileNotFoundException(
                $"Python executable was not found: {pythonExecutable}");
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = pythonExecutable,
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        startInfo.ArgumentList.Add("-u");
        startInfo.ArgumentList.Add("-m");
        startInfo.ArgumentList.Add("app.worker");
        startInfo.Environment["PYTHONUNBUFFERED"] = "1";

        _process = new Process
        {
            StartInfo = startInfo,
            EnableRaisingEvents = true
        };

        _logger.LogInformation(
            "Starting OCR worker using {PythonExecutable} in {WorkingDirectory}",
            pythonExecutable,
            workingDirectory);

        if (!_process.Start())
        {
            throw new InvalidOperationException(
                "The Python OCR worker process could not be started.");
        }

        _stderrPump = PumpStandardErrorAsync(
            _process.StandardError,
            cancellationToken);

        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(
                cancellationToken);
            timeout.CancelAfter(TimeSpan.FromMinutes(startupTimeoutMinutes));

            var startupLine = await _process.StandardOutput.ReadLineAsync(
                timeout.Token);

            if (startupLine is null)
            {
                throw new InvalidOperationException(
                    $"Python OCR worker exited during startup. Exit code: " +
                    $"{GetExitCode()}");
            }

            using var startupMessage = JsonDocument.Parse(startupLine);
            var root = startupMessage.RootElement;

            var messageType = root.TryGetProperty("type", out var typeElement)
                ? typeElement.GetString()
                : null;

            if (messageType != "ready" ||
                !root.TryGetProperty("success", out var successElement) ||
                !successElement.GetBoolean())
            {
                var error = root.TryGetProperty("error", out var errorElement)
                    ? errorElement.GetString()
                    : "Worker returned an unexpected startup response.";

                throw new InvalidOperationException(
                    $"Python OCR worker failed to initialize: {error}");
            }

            _isReady = true;
            _logger.LogInformation("Python OCR worker is ready.");
        }
        catch
        {
            StopWorkerProcess();
            throw;
        }
    }

    public async Task<string> ExtractAsync(
        string documentPath,
        string filename,
        CancellationToken cancellationToken)
    {
        await _requestLock.WaitAsync(cancellationToken);

        try
        {
            if (!IsReady || _process is null)
            {
                throw new InvalidOperationException(
                    "Python OCR worker is not available.");
            }

            var requestId = Guid.NewGuid().ToString("N");

            var requestLine = JsonSerializer.Serialize(new
            {
                request_id = requestId,
                document_path = documentPath,
                filename
            });

            await _process.StandardInput.WriteLineAsync(requestLine);
            await _process.StandardInput.FlushAsync();

            // Once sent, always consume the matching worker response even if
            // the HTTP caller disconnects. This keeps the line protocol in sync.
            var requestTimeoutMinutes = _configuration
                .GetSection("OcrWorker")
                .GetValue("RequestTimeoutMinutes", 30);

            using var timeout = new CancellationTokenSource(
                TimeSpan.FromMinutes(requestTimeoutMinutes));

            string? responseLine;

            try
            {
                responseLine = await _process.StandardOutput.ReadLineAsync(
                    timeout.Token);
            }
            catch (OperationCanceledException)
            {
                _logger.LogError(
                    "OCR worker timed out while processing {Filename}.",
                    filename);

                StopWorkerProcess();

                throw new TimeoutException(
                    "Document processing exceeded the configured worker timeout.");
            }

            if (responseLine is null)
            {
                _isReady = false;

                throw new InvalidOperationException(
                    $"Python OCR worker stopped unexpectedly. Exit code: " +
                    $"{GetExitCode()}");
            }

            using var response = JsonDocument.Parse(responseLine);
            var root = response.RootElement;

            var responseRequestId = root.TryGetProperty(
                "request_id", out var idElement)
                ? idElement.GetString()
                : null;

            if (responseRequestId != requestId)
            {
                _isReady = false;
                StopWorkerProcess();

                throw new InvalidOperationException(
                    "Python OCR worker returned a mismatched response.");
            }

            return responseLine;
        }
        catch (IOException exception)
        {
            _isReady = false;

            _logger.LogError(
                exception,
                "Communication with the Python OCR worker failed.");

            throw new InvalidOperationException(
                "Communication with the Python OCR worker failed.",
                exception);
        }
        finally
        {
            _requestLock.Release();
        }
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        if (_process is null)
        {
            return;
        }

        _logger.LogInformation("Stopping Python OCR worker.");

        try
        {
            if (!_process.HasExited)
            {
                _process.StandardInput.Close();

                using var timeout =
                    CancellationTokenSource.CreateLinkedTokenSource(
                        cancellationToken);
                timeout.CancelAfter(TimeSpan.FromSeconds(10));

                await _process.WaitForExitAsync(timeout.Token);
            }
        }
        catch (OperationCanceledException)
        {
            _logger.LogWarning(
                "OCR worker did not stop gracefully; terminating it.");

            StopWorkerProcess();
        }
        catch (InvalidOperationException)
        {
            StopWorkerProcess();
        }
        finally
        {
            _isReady = false;

            if (_stderrPump is not null)
            {
                try
                {
                    await _stderrPump.WaitAsync(
                        TimeSpan.FromSeconds(2),
                        cancellationToken);
                }
                catch (TimeoutException)
                {
                    // The process has already been stopped.
                }
                catch (OperationCanceledException)
                {
                    // Host shutdown is already in progress.
                }
            }
        }
    }

    private async Task PumpStandardErrorAsync(
        StreamReader reader,
        CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var line = await reader.ReadLineAsync(cancellationToken);

                if (line is null)
                {
                    break;
                }

                _logger.LogInformation("OCR worker: {WorkerLog}", line);
            }
        }
        catch (OperationCanceledException)
        {
            // Expected during application shutdown.
        }
        catch (ObjectDisposedException)
        {
            // Expected after process shutdown.
        }
    }

    private string ResolvePath(string configuredPath)
    {
        return Path.GetFullPath(
            configuredPath,
            _environment.ContentRootPath);
    }

    private int? GetExitCode()
    {
        try
        {
            return _process is { HasExited: true }
                ? _process.ExitCode
                : null;
        }
        catch (InvalidOperationException)
        {
            return null;
        }
    }

    private void StopWorkerProcess()
    {
        _isReady = false;

        try
        {
            if (_process is { HasExited: false })
            {
                _process.Kill(entireProcessTree: true);
                _process.WaitForExit(5000);
            }
        }
        catch (InvalidOperationException)
        {
            // Process already exited.
        }
        catch (System.ComponentModel.Win32Exception exception)
        {
            _logger.LogWarning(
                exception,
                "Could not terminate the Python OCR worker.");
        }
    }

    public void Dispose()
    {
        StopWorkerProcess();
        _process?.Dispose();
        _requestLock.Dispose();
    }
}
