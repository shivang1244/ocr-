
import logging
import threading
import time

from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
from paddleocr import PaddleOCRVL

logger = logging.getLogger(__name__)

_inference_lock = threading.Lock()


@lru_cache(maxsize=1)
def get_ocr_engine() -> PaddleOCRVL:
    """Initialize and reuse the OCR engine."""

    started = time.perf_counter()

    logger.info("Initializing PaddleOCR-VL v1.6")

    engine = PaddleOCRVL(
    pipeline_version="v1.6",
    use_doc_orientation_classify=True,
    use_doc_unwarping=False,
    use_layout_detection=True,
    device="gpu:0",
)

    logger.info(
        "OCR engine initialized in %.2f seconds",
        time.perf_counter() - started
    )

    return engine


def make_json_serializable(value: Any) -> Any:

    if isinstance(value, dict):
        return {
            str(key): make_json_serializable(item)
            for key, item in value.items()
        }

    if isinstance(value, (list, tuple)):
        return [
            make_json_serializable(item)
            for item in value
        ]

    if isinstance(value, np.ndarray):
        return value.tolist()

    if isinstance(value, np.generic):
        return value.item()

    if isinstance(value, Path):
        return str(value)

    if isinstance(value, float):
        return value if np.isfinite(value) else None

    if isinstance(value, (str, int, bool)) or value is None:
        return value

    return str(value)


def discover_text_blocks(value: Any, page_number: int) -> list[dict]:
    """
    Recursively discover textual blocks from OCR output.

    This uses the OCR engine's output structure, not document types
    or predefined business field names.
    """

    blocks = []

    def walk(node):

        if isinstance(node, dict):

            content = node.get("block_content")

            if isinstance(content, str) and content.strip():

                blocks.append({
                    "page_number": page_number,
                    "block_id": node.get("block_id"),
                    "type": node.get("block_label"),
                    "text": content,
                    "bounding_box": node.get("block_bbox"),
                    "reading_order": node.get("block_order")
                })

            for key, item in node.items():
                if key != "block_content":
                    walk(item)

        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(value)

    return blocks


def extract_document(document_path: str) -> dict:

    path = Path(document_path)

    if not path.is_file():
        raise FileNotFoundError(
            f"Document not found: {path}"
        )

    engine = get_ocr_engine()

    total_started = time.perf_counter()

    logger.info("Processing document: %s", path.name)

    lock_started = time.perf_counter()

    try:

        with _inference_lock:

            lock_wait = time.perf_counter() - lock_started

            inference_started = time.perf_counter()

            logger.info("OCR inference started")

            results = engine.predict(
                input=str(path),
                use_doc_orientation_classify=True,
                use_doc_unwarping=False,
                use_layout_detection=True,
            )

            inference_duration = (
                time.perf_counter() - inference_started
            )

            logger.info(
                "OCR inference completed in %.2f seconds",
                inference_duration
            )

            serialization_started = time.perf_counter()

            pages = []
            text_blocks = []

            for index, result in enumerate(results, start=1):

                raw_result = result.json

                if callable(raw_result):
                    raw_result = raw_result()

                normalized = make_json_serializable(
                    raw_result
                )

                pages.append({
                    "page_number": index,
                    "result": normalized
                })

                text_blocks.extend(
                    discover_text_blocks(
                        normalized,
                        index
                    )
                )

            serialization_duration = (
                time.perf_counter() - serialization_started
            )

        if not pages:
            raise ValueError("OCR returned no page results.")

        timings = {
            "lock_wait_seconds": round(lock_wait, 3),
            "inference_seconds": round(inference_duration, 3),
            "serialization_seconds": round(
                serialization_duration, 3
            ),
            "total_ocr_seconds": round(
                time.perf_counter() - total_started, 3
            )
        }

        logger.info(
            "OCR completed | inference %.2fs | serialization %.2fs | total %.2fs",
            inference_duration,
            serialization_duration,
            time.perf_counter() - total_started
        )

        return {
            "pages": pages,
            "text_blocks": text_blocks,
            "timings": timings
        }

    except Exception:
        logger.exception(
            "OCR failed for document: %s",
            path.name
        )
        raise
