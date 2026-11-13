
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  "http://127.0.0.1:5270/api";


export function extractDocument(
  file,
  signal,
  callbacks = {}
) {
  return new Promise((resolve, reject) => {

    if (!(file instanceof File)) {
      reject(
        new Error("Please select a valid document.")
      );
      return;
    }

    if (signal?.aborted) {
      reject(
        new DOMException("Request aborted.", "AbortError")
      );
      return;
    }

    const formData = new FormData();

    formData.append("file", file);

    const xhr = new XMLHttpRequest();

    let settled = false;

    function cleanup() {
      signal?.removeEventListener("abort", handleAbort);
    }

    function finish(callback, value) {
      if (settled) return;

      settled = true;
      cleanup();

      callback(value);
    }

    function handleAbort() {
      xhr.abort();

      finish(
        reject,
        new DOMException("Request aborted.", "AbortError")
      );
    }

    signal?.addEventListener("abort", handleAbort);

    xhr.open(
      "POST",
      `${API_BASE_URL}/documents/extract`
    );

    xhr.responseType = "json";
    xhr.timeout = 0;

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;

      const progress = Math.round(
        (event.loaded / event.total) * 100
      );

      callbacks.onUploadProgress?.(progress);
    };

    xhr.upload.onload = () => {
      callbacks.onUploadProgress?.(100);
      callbacks.onStatusChange?.("processing");
    };

    xhr.onload = () => {
      const data = xhr.response;

      if (!data || typeof data !== "object") {
        finish(
          reject,
          new Error("The server returned an invalid response.")
        );
        return;
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        finish(
          reject,
          new Error(
            typeof data.detail === "string"
              ? data.detail
              : "Document extraction failed."
          )
        );
        return;
      }

      if (
        data.success !== true ||
        !Array.isArray(data.pages)
      ) {
        finish(
          reject,
          new Error(
            "The server returned an unexpected extraction response."
          )
        );
        return;
      }

      finish(resolve, data);
    };

    xhr.onerror = () => {
      finish(
        reject,
        new Error(
          "Unable to connect to the document processing server."
        )
      );
    };

    xhr.ontimeout = () => {
      finish(
        reject,
        new Error(
          "The document processing request timed out."
        )
      );
    };

    xhr.onabort = () => {
      finish(
        reject,
        new DOMException("Request aborted.", "AbortError")
      );
    };

    xhr.send(formData);
  });
}
