
import { useEffect, useRef, useState } from "react";
import {
  ScanText,
  ShieldCheck,
  FileSearch,
  LoaderCircle,
  RotateCcw,
  AlertCircle,
  Activity,
  FileJson,
  Globe2,
  CheckCircle2,
  Clock3,
} from "lucide-react";

import UploadZone from "./components/UploadZone";
import ResultsPanel from "./components/ResultsPanel";
import { extractDocument } from "./services/documentApi";

import "./App.css";

export default function App() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const [processingStatus, setProcessingStatus] = useState("ready");
  const [uploadProgress, setUploadProgress] = useState(0);

  const controllerRef = useRef(null);

  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }

    const url = URL.createObjectURL(file);
    setPreview(url);

    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  function handleFileSelect(selectedFile) {
    if (loading) return;

    setFile(selectedFile);
    setResult(null);
    setError("");
    setUploadProgress(0);
    setProcessingStatus("ready");
  }

  async function handleExtract() {
    if (!file || loading) return;

    const controller = new AbortController();
    controllerRef.current = controller;

    setLoading(true);
    setError("");
    setResult(null);
    setUploadProgress(0);
    setProcessingStatus("uploading");

    try {
      const response = await extractDocument(
        file,
        controller.signal,
        {
          onUploadProgress: (progress) => {
            setUploadProgress(progress);
          },

          onStatusChange: (status) => {
            setProcessingStatus(status);
          },
        }
      );

      setResult(response);
      setProcessingStatus("completed");

    } catch (err) {
      if (err.name !== "AbortError") {
        setError(
          err.message || "Document extraction failed."
        );

        setProcessingStatus("failed");
      } else {
        setProcessingStatus("ready");
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setLoading(false);
      }
    }
  }

  function handleReset() {
    controllerRef.current?.abort();
    controllerRef.current = null;

    setFile(null);
    setResult(null);
    setError("");
    setLoading(false);
    setUploadProgress(0);
    setProcessingStatus("ready");
  }

  const isPdf =
    file?.type === "application/pdf" ||
    file?.name?.toLowerCase().endsWith(".pdf");

  const statusConfig = {
    ready: {
      label: "Ready",
      className: "ready",
    },
    uploading: {
      label: "Uploading",
      className: "uploading",
    },
    processing: {
      label: "Processing",
      className: "processing",
    },
    completed: {
      label: "Completed",
      className: "completed",
    },
    failed: {
      label: "Failed",
      className: "failed",
    },
  };

  const currentStatus =
    statusConfig[processingStatus] || statusConfig.ready;

  const timings = result?.timings || {};

  function formatDuration(value) {
    if (typeof value !== "number") return "—";

    return `${value.toFixed(2)} s`;
  }

  return (
    <div className="app-shell">

      {/* Navigation */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">
            <ScanText size={25} />
          </div>

          <div>
            <h1>Universal Document Intelligence</h1>
            <span>Multilingual document extraction platform</span>
          </div>
        </div>

        <div className={`service-status ${currentStatus.className}`}>
          {loading ? (
            <LoaderCircle size={15} className="spin" />
          ) : processingStatus === "completed" ? (
            <CheckCircle2 size={15} />
          ) : processingStatus === "failed" ? (
            <AlertCircle size={15} />
          ) : (
            <span className="status-dot" />
          )}

          <span>{currentStatus.label}</span>
          <span className="status-divider" />
          <span className="version-label">v0.1.0</span>
        </div>
      </header>

      {/* Page heading */}
      <section className="page-heading">
        <div>
          <div className="eyebrow">
            <ShieldCheck size={15} />
            DOCUMENT PROCESSING
          </div>

          <h2>Document Workspace</h2>

          <p>
            Upload any document. Extract its content.
            Preserve every language.
          </p>
        </div>

        <div className="heading-features">
          <div>
            <Globe2 size={16} />
            Multilingual processing
          </div>

          <div>
            <ShieldCheck size={16} />
            Structured extraction
          </div>
        </div>
      </section>

      {/* Main workspace */}
      <main className="workspace-grid">

        {/* LEFT: Upload */}
        <section className="panel upload-panel">
          <div className="panel-heading">
            <div className="panel-title">
              <div className="step-number">01</div>

              <div>
                <h3>Upload document</h3>
                <p>Select a document to extract</p>
              </div>
            </div>

            {file && (
              <button
                className="icon-button"
                onClick={handleReset}
                disabled={loading}
                title="Reset workspace"
              >
                <RotateCcw size={17} />
              </button>
            )}
          </div>

          <UploadZone
            file={file}
            onFileSelect={handleFileSelect}
            disabled={loading}
          />

          {file && (
            <div className="file-summary">
              <FileSearch size={17} />

              <div>
                <strong>{file.name}</strong>
                <span>
                  {(file.size / (1024 * 1024)).toFixed(2)} MB
                </span>
              </div>
            </div>
          )}

          {preview && (
            <div className="preview-panel">
              <div className="preview-heading">
                <FileSearch size={16} />
                <span>Document preview</span>
              </div>

              {isPdf ? (
                <iframe
                  src={preview}
                  title="PDF document preview"
                  className="pdf-preview"
                />
              ) : (
                <img
                  src={preview}
                  alt="Uploaded document"
                  className="image-preview"
                />
              )}
            </div>
          )}

          <div className="upload-footer">
            <div className="supported-formats">
              <span>SUPPORTED FORMATS</span>

              <div>
                <span>PDF</span>
                <span>PNG</span>
                <span>JPG</span>
                <span>WEBP</span>
              </div>
            </div>

            <button
              className="extract-button"
              disabled={!file || loading}
              onClick={handleExtract}
            >
              {loading ? (
                <>
                  <LoaderCircle className="spin" size={18} />
                  {processingStatus === "uploading"
                    ? "Uploading..."
                    : "Processing..."}
                </>
              ) : (
                <>
                  <ScanText size={18} />
                  Extract document
                </>
              )}
            </button>
          </div>

          {loading && (
            <div className="processing-indicator" role="status">
              <LoaderCircle className="spin" size={16} />

              <span>
                {processingStatus === "uploading"
                  ? `Uploading document... ${uploadProgress}%`
                  : "Extracting document content..."}
              </span>
            </div>
          )}

          {error && (
            <div className="error-banner" role="alert">
              <AlertCircle size={17} />
              {error}
            </div>
          )}
        </section>

        {/* RIGHT: Results */}
        <section className="panel extraction-panel">
          <div className="panel-heading">
            <div className="panel-title">
              <div className="step-number">02</div>

              <div>
                <h3>Extracted information</h3>
                <p>Recognized document content and output</p>
              </div>
            </div>

            {result && (
              <div className="result-status">
                <span className="status-dot" />
                Completed
              </div>
            )}
          </div>

          <div className="result-metrics">
            <div className="metric">
              <FileSearch size={17} />

              <div>
                <strong>{result?.page_count ?? "—"}</strong>
                <span>Pages</span>
              </div>
            </div>

            <div className="metric">
              <FileJson size={17} />

              <div>
                <strong>{result ? "JSON" : "—"}</strong>
                <span>Output format</span>
              </div>
            </div>

            <div className="metric">
              <Activity size={17} />

              <div>
                <strong>
                  {result ? "Completed" : currentStatus.label}
                </strong>
                <span>Processing</span>
              </div>
            </div>
          </div>

          <div className="results-content">
            {loading ? (
              <div className="results-empty">
                <LoaderCircle className="spin" size={34} />

                <h3>
                  {processingStatus === "uploading"
                    ? "Uploading document"
                    : "Processing document"}
                </h3>

                <p>
                  {processingStatus === "uploading"
                    ? "Sending your document to the processing server."
                    : "Recognizing text and document structure. Please wait."}
                </p>
              </div>
            ) : (
              <ResultsPanel result={result} />
            )}
          </div>

          {result && (
            <>
              <div className="result-footer">
                <span>
                  Engine: {result.extraction_engine || "PaddleOCR-VL"}
                </span>

                <span>
                  Pipeline: {result.pipeline_version || "v1.6"}
                </span>
              </div>

              <div className="timing-summary">
                <div>
                  <Clock3 size={15} />
                  <span>OCR inference</span>
                  <strong>
                    {formatDuration(timings.inference_seconds)}
                  </strong>
                </div>

                <div>
                  <Activity size={15} />
                  <span>Total processing</span>
                  <strong>
                    {formatDuration(
                      timings.total_request_processing_seconds
                    )}
                  </strong>
                </div>
              </div>
            </>
          )}
        </section>
      </main>

      <footer className="app-footer">
        <span>Universal Document Intelligence</span>
        <span>Document processing workspace · v0.1.0</span>
      </footer>
    </div>
  );
}
