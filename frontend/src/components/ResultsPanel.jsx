
import { useState } from "react";

import {
  Copy,
  Check,
  FileText,
  Code2,
  Download,
  LayoutGrid,
  Clock3,
} from "lucide-react";


export default function ResultsPanel({ result }) {
  const [activeTab, setActiveTab] = useState("content");
  const [copied, setCopied] = useState(false);

  if (!result) {
    return (
      <div className="empty-results">
        <FileText size={36} />

        <h3>No extraction results yet</h3>

        <p>
          Upload a document and start extraction to see
          the recognized content here.
        </p>
      </div>
    );
  }

  const pages = result.pages || [];
  const blocks = result.text_blocks || [];
  const timings = result.timings || {};

  const jsonOutput = JSON.stringify(result, null, 2);

  const textOutput = blocks
    .map((block) => block.text || "")
    .join("\n\n");

  const layoutOutput = blocks
    .map((block) => ({
      page_number: block.page_number,
      block_id: block.block_id,
      type: block.type,
      reading_order: block.reading_order,
      bounding_box: block.bounding_box,
      text: block.text,
    }));

  const layoutJson = JSON.stringify(
    layoutOutput,
    null,
    2
  );

  const contentToCopy = {
    content: textOutput,
    json: jsonOutput,
    layout: layoutJson,
  }[activeTab];

  async function copyContent() {
    try {
      await navigator.clipboard.writeText(contentToCopy);

      setCopied(true);

      window.setTimeout(() => {
        setCopied(false);
      }, 2000);

    } catch {
      setCopied(false);
    }
  }

  function downloadJson() {
    const blob = new Blob(
      [jsonOutput],
      {
        type: "application/json;charset=utf-8",
      }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;

    link.download = `${
      result.document_id || "document"
    }_extraction.json`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
  }

  function renderContent() {
    if (!blocks.length) {
      return (
        <div className="results-empty">
          <FileText size={30} />

          <h3>No readable text blocks found</h3>

          <p>
            The OCR response is available in the Raw OCR JSON tab.
            We can inspect its structure and improve the
            dynamic block parser.
          </p>
        </div>
      );
    }

    return (
      <div className="recognized-content">
        {blocks.map((block, index) => (
          <article
            className="recognized-block"
            key={`${block.page_number}-${block.block_id ?? index}`}
          >
            <div className="recognized-block-header">
              <span>
                Page {block.page_number ?? "—"}
              </span>

              <span>
                {block.type || "Text block"}
              </span>

              {block.reading_order !== undefined &&
                block.reading_order !== null && (
                  <span>
                    Order {block.reading_order}
                  </span>
                )}
            </div>

            <div className="recognized-block-content">
              {block.text}
            </div>
          </article>
        ))}
      </div>
    );
  }

  function renderLayout() {
    if (!blocks.length) {
      return (
        <div className="results-empty">
          <LayoutGrid size={30} />

          <h3>No layout information available</h3>

          <p>
            Layout information will appear when it is
            provided by the OCR engine.
          </p>
        </div>
      );
    }

    return (
      <div className="layout-list">
        {blocks.map((block, index) => (
          <article
            className="layout-block"
            key={`${block.page_number}-${block.block_id ?? index}`}
          >
            <div className="layout-block-heading">
              <strong>
                Block {block.block_id ?? index + 1}
              </strong>

              <span>
                Page {block.page_number ?? "—"}
              </span>
            </div>

            <p>{block.text}</p>

            <div className="layout-metadata">
              <span>
                Type: {block.type || "Not provided"}
              </span>

              <span>
                Reading order: {block.reading_order ?? "—"}
              </span>
            </div>

            <details>
              <summary>Bounding box</summary>

              <pre>
                {JSON.stringify(
                  block.bounding_box ?? null,
                  null,
                  2
                )}
              </pre>
            </details>
          </article>
        ))}
      </div>
    );
  }

  return (
    <div className="results-panel">

      <div className="results-header">
        <div>
          <h3>Extraction results</h3>

          <span>
            {result.page_count} page(s) processed
            {" · "}
            {result.extraction_engine || "OCR"}
            {" · "}
            {blocks.length} recognized block(s)
          </span>
        </div>

        <div className="result-actions">
          <button
            className="copy-button"
            onClick={copyContent}
            title="Copy current tab"
          >
            {copied ? (
              <Check size={16} />
            ) : (
              <Copy size={16} />
            )}

            {copied ? "Copied" : "Copy"}
          </button>

          <button
            className="copy-button"
            onClick={downloadJson}
            title="Download complete OCR response"
          >
            <Download size={16} />
            Export JSON
          </button>
        </div>
      </div>

      <div className="result-tabs">

        <button
          className={
            activeTab === "content" ? "active-tab" : ""
          }
          onClick={() => {
            setActiveTab("content");
            setCopied(false);
          }}
        >
          <FileText size={15} />
          Extracted Content
        </button>

        <button
          className={
            activeTab === "json" ? "active-tab" : ""
          }
          onClick={() => {
            setActiveTab("json");
            setCopied(false);
          }}
        >
          <Code2 size={15} />
          Raw OCR JSON
        </button>

        <button
          className={
            activeTab === "layout" ? "active-tab" : ""
          }
          onClick={() => {
            setActiveTab("layout");
            setCopied(false);
          }}
        >
          <LayoutGrid size={15} />
          Layout
        </button>

      </div>

      <div className="result-tab-content">

        {activeTab === "content" && renderContent()}

        {activeTab === "json" && (
          <pre className="json-viewer">
            <code>{jsonOutput}</code>
          </pre>
        )}

        {activeTab === "layout" && renderLayout()}

      </div>

      <div className="results-processing-time">
        <Clock3 size={14} />

        <span>Inference</span>

        <strong>
          {typeof timings.inference_seconds === "number"
            ? `${timings.inference_seconds.toFixed(2)} s`
            : "Not available"}
        </strong>

        <span className="timing-separator">·</span>

        <span>Serialization</span>

        <strong>
          {typeof timings.serialization_seconds === "number"
            ? `${timings.serialization_seconds.toFixed(2)} s`
            : "Not available"}
        </strong>
      </div>
    </div>
  );
}
