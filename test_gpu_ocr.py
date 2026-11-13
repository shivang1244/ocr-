import time
import paddle
from paddleocr import PaddleOCRVL

paddle.set_device("gpu:0")

print("Paddle:", paddle.__version__)
print("Device:", paddle.device.get_device())
print("Initializing PaddleOCR-VL v1.6...")

started = time.perf_counter()

engine = PaddleOCRVL(
    pipeline_version="v1.6",
    use_doc_orientation_classify=True,
    use_doc_unwarping=False,
    use_layout_detection=True,
    device="gpu:0",
)

print("MODEL INITIALIZED SUCCESSFULLY")
print("Initialization time:", round(time.perf_counter() - started, 2), "seconds")
print("Current device:", paddle.device.get_device())
