import json
import logging
import os
import sys
from contextlib import redirect_stdout
from pathlib import Path


# Preserve the original stdout pipe for protocol messages, then redirect
# process stdout to stderr. This also catches native-library writes to fd 1.
_protocol_fd = os.dup(sys.stdout.fileno())
os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
protocol_output = os.fdopen(
    _protocol_fd,
    "w",
    buffering=1,
    encoding="utf-8",
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    stream=sys.stderr,
    force=True,
)

logger = logging.getLogger("ocr_worker")


class WorkerRequestError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def send_message(message: dict) -> None:
    protocol_output.write(
        json.dumps(message, ensure_ascii=False, allow_nan=False) + "\n"
    )
    protocol_output.flush()


def validate_document(path: Path) -> None:
    """Apply the existing upload constraints before invoking OCR."""
    if not path.is_file():
        raise WorkerRequestError("Uploaded document could not be found.")

    if path.suffix.lower() == ".pdf":
        try:
            import pymupdf

            with pymupdf.open(str(path)) as pdf:
                if pdf.page_count == 0:
                    raise WorkerRequestError("PDF contains no pages.")
                if pdf.page_count > 20:
                    raise WorkerRequestError("Maximum 20 PDF pages allowed.")
        except WorkerRequestError:
            raise
        except Exception as exc:
            raise WorkerRequestError(
                "Invalid or corrupted PDF document."
            ) from exc


def main() -> int:
    logger.info("Starting persistent OCR worker")

    try:
        # Import and initialize the existing OCR implementation once.
        # Redirect Python-level library output away from protocol stdout.
        with redirect_stdout(sys.stderr):
            from app.ocr.engine import get_ocr_engine
            from app.services.document_service import process_uploaded_document

            get_ocr_engine()

    except Exception as exc:
        logger.exception("OCR worker initialization failed")
        send_message({
            "type": "startup_error",
            "success": False,
            "error": str(exc),
        })
        return 1

    send_message({"type": "ready", "success": True})
    logger.info("OCR worker is ready")

    for line in sys.stdin:
        if not line.strip():
            continue

        request_id = None

        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise WorkerRequestError("Request must be a JSON object.")

            request_id = request.get("request_id")
            document_path = request.get("document_path")
            filename = request.get("filename")

            if not isinstance(request_id, str) or not request_id:
                raise WorkerRequestError("request_id is required.")
            if not isinstance(document_path, str) or not document_path:
                raise WorkerRequestError("document_path is required.")
            if not isinstance(filename, str) or not filename:
                raise WorkerRequestError("filename is required.")

            path = Path(document_path)
            validate_document(path)

            logger.info("Processing request %s: %s", request_id, filename)

            # Reuse the existing service unchanged. It calls the existing
            # PaddleOCR-VL engine and preserves pages, blocks and timings.
            with redirect_stdout(sys.stderr):
                result = process_uploaded_document(str(path), filename)

            send_message({
                "type": "result",
                "request_id": request_id,
                "success": True,
                "result": result,
            })

            logger.info("Completed request %s", request_id)

        except WorkerRequestError as exc:
            logger.warning("Rejected request %s: %s", request_id, exc)
            send_message({
                "type": "result",
                "request_id": request_id,
                "success": False,
                "status_code": exc.status_code,
                "error": str(exc),
            })

        except Exception as exc:
            logger.exception("OCR processing failed for request %s", request_id)
            send_message({
                "type": "result",
                "request_id": request_id,
                "success": False,
                "status_code": 500,
                "error": "Document processing failed. Check backend logs.",
            })

    logger.info("OCR worker shutting down")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
