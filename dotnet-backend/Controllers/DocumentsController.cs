using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using UniversalDocument.Api.Services;

namespace UniversalDocument.Api.Controllers;

[ApiController]
[Route("api/documents")]
public sealed class DocumentsController : ControllerBase
{
    private const long MaxFileSize = 15 * 1024 * 1024;
    private const long MaxRequestSize = 16 * 1024 * 1024;

    private static readonly HashSet<string> SupportedExtensions =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ".png", ".jpg", ".jpeg", ".webp", ".pdf"
        };

    private readonly OcrWorkerService _worker;
    private readonly ILogger<DocumentsController> _logger;

    public DocumentsController(
        OcrWorkerService worker,
        ILogger<DocumentsController> logger)
    {
        _worker = worker;
        _logger = logger;
    }

    [HttpPost("extract")]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(MaxRequestSize)]
    [RequestFormLimits(MultipartBodyLengthLimit = MaxRequestSize)]
    public async Task<IActionResult> Extract(
        [FromForm] IFormFile? file,
        CancellationToken cancellationToken)
    {
        if (file is null)
        {
            return BadRequest(new { detail = "No document was uploaded." });
        }

        if (file.Length == 0)
        {
            return BadRequest(new { detail = "Uploaded document is empty." });
        }

        if (file.Length > MaxFileSize)
        {
            return StatusCode(413, new
            {
                detail = "Maximum upload size is 15 MB."
            });
        }

        var filename = Path.GetFileName(file.FileName);
        var extension = Path.GetExtension(filename);

        if (string.IsNullOrWhiteSpace(filename) ||
            !SupportedExtensions.Contains(extension))
        {
            return BadRequest(new
            {
                detail = "Unsupported document format."
            });
        }

        var temporaryPath = Path.Combine(
            Path.GetTempPath(),
            $"{Guid.NewGuid():N}{extension.ToLowerInvariant()}");

        try
        {
            await using (var input = file.OpenReadStream())
            await using (var output = new FileStream(
                temporaryPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                bufferSize: 81920,
                options: FileOptions.Asynchronous |
                         FileOptions.SequentialScan))
            {
                await input.CopyToAsync(output, cancellationToken);
            }

            if (!await HasValidSignatureAsync(
                temporaryPath,
                extension,
                cancellationToken))
            {
                return BadRequest(new
                {
                    detail = "File content does not match the selected file format."
                });
            }

            _logger.LogInformation(
                "Received document {Filename} ({Length} bytes)",
                filename,
                file.Length);

            var workerResponse = await _worker.ExtractAsync(
                temporaryPath,
                filename,
                cancellationToken);

            using var responseDocument = JsonDocument.Parse(workerResponse);
            var root = responseDocument.RootElement;

            if (root.TryGetProperty("success", out var success) &&
                success.ValueKind == JsonValueKind.True &&
                root.TryGetProperty("result", out var result))
            {
                // Return the original Python service response without
                // deserializing/rebuilding its dynamic OCR page structures.
                return Content(result.GetRawText(), "application/json");
            }

            var detail = root.TryGetProperty("error", out var error)
                ? error.GetString() ?? "Document processing failed."
                : "Document processing failed.";

            var statusCode = root.TryGetProperty(
                "status_code", out var status)
                ? status.GetInt32()
                : StatusCodes.Status500InternalServerError;

            if (statusCode is not (400 or 413))
            {
                statusCode = StatusCodes.Status500InternalServerError;
            }

            return StatusCode(statusCode, new { detail });
        }
        catch (TimeoutException exception)
        {
            _logger.LogError(exception, "OCR worker timed out for {Filename}", filename);

            return StatusCode(StatusCodes.Status504GatewayTimeout, new
            {
                detail = "Document processing timed out."
            });
        }
        catch (InvalidOperationException exception)
        {
            _logger.LogError(exception, "OCR worker is unavailable.");

            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                detail = "OCR worker is currently unavailable."
            });
        }
        catch (IOException exception)
        {
            _logger.LogError(exception, "Document upload or temporary file operation failed.");

            return StatusCode(StatusCodes.Status500InternalServerError, new
            {
                detail = "Document could not be processed."
            });
        }
        finally
        {
            try
            {
                System.IO.File.Delete(temporaryPath);
            }
            catch (IOException exception)
            {
                _logger.LogWarning(
                    exception,
                    "Could not delete temporary document {TemporaryPath}",
                    temporaryPath);
            }
        }
    }

    private static async Task<bool> HasValidSignatureAsync(
        string path,
        string extension,
        CancellationToken cancellationToken)
    {
        var header = new byte[12];

        await using var stream = System.IO.File.OpenRead(path);
        var bytesRead = await stream.ReadAsync(
            header.AsMemory(),
            cancellationToken);

        return extension.ToLowerInvariant() switch
        {
            ".png" => bytesRead >= 8 &&
                header.AsSpan(0, 8).SequenceEqual(
                    new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }),

            ".jpg" or ".jpeg" => bytesRead >= 3 &&
                header[0] == 0xFF &&
                header[1] == 0xD8 &&
                header[2] == 0xFF,

            ".webp" => bytesRead >= 12 &&
                header.AsSpan(0, 4).SequenceEqual("RIFF"u8) &&
                header.AsSpan(8, 4).SequenceEqual("WEBP"u8),

            ".pdf" => bytesRead >= 5 &&
                header.AsSpan(0, 5).SequenceEqual("%PDF-"u8),

            _ => false
        };
    }
}
