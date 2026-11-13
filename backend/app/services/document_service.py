
import logging
import time

from uuid import uuid4

from app.ocr.engine import extract_document

logger = logging.getLogger(__name__)


def process_uploaded_document(
    document_path: str,
    original_filename: str
) -> dict:

    document_id = str(uuid4())

    started = time.perf_counter()

    logger.info(
        "Starting document processing: %s",
        document_id
    )

    ocr_output = extract_document(document_path)

    timings = dict(ocr_output["timings"])

    timings["total_request_processing_seconds"] = round(
        time.perf_counter() - started,
        3
    )

    response = {
        "success": True,
        "document_id": document_id,
        "filename": original_filename,
        "page_count": len(ocr_output["pages"]),
        "extraction_engine": "PaddleOCR-VL",
        "pipeline_version": "v1.6",

        # Dynamic recognized content
        "text_blocks": ocr_output["text_blocks"],

        # Original OCR response
        "pages": ocr_output["pages"],

        # Actual measured timings
        "timings": timings
    }

    logger.info(
        "Document processing completed: %s",
        document_id
    )

    return response
