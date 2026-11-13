
import { useRef, useState } from "react";
import { UploadCloud, FileText, X } from "lucide-react";

const MAX_FILE_SIZE = 15 * 1024 * 1024;

const ALLOWED_EXTENSIONS = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
];

export default function UploadZone({
  file,
  onFileSelect,
  disabled = false,
}) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  function validateFile(selectedFile) {
    setError("");

    if (!selectedFile) return;

    const extension = selectedFile.name
      .split(".")
      .pop()
      .toLowerCase();

    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      setError("Unsupported format. Upload PDF, PNG, JPG or WEBP.");
      return;
    }

    if (selectedFile.size === 0) {
      setError("The selected file is empty.");
      return;
    }

    if (selectedFile.size > MAX_FILE_SIZE) {
      setError("File size cannot exceed 15 MB.");
      return;
    }

    onFileSelect(selectedFile);
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragging(false);

    if (disabled) return;

    const files = event.dataTransfer.files;

    if (files.length !== 1) {
      setError("Please upload one document at a time.");
      return;
    }

    validateFile(files[0]);
  }

  return (
    <div className="upload-wrapper">
      <div
        className={`upload-zone ${dragging ? "dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setDragging(false);
          }
        }}
        onDrop={handleDrop}
        onClick={() => {
          if (!disabled && !file) {
            inputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={disabled || file ? -1 : 0}
        onKeyDown={(event) => {
          if (
            !disabled &&
            !file &&
            (event.key === "Enter" || event.key === " ")
          ) {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp"
          hidden
          disabled={disabled}
          onChange={(event) => {
            validateFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />

        {!file ? (
          <div className="upload-content">
            <div className="upload-icon">
              <UploadCloud size={32} />
            </div>

            <h3>Upload your document</h3>

            <p>
              Drag and drop your document here, or browse files
            </p>

            <span className="file-hint">
              PDF, PNG, JPG, JPEG, WEBP · Maximum 15 MB
            </span>
          </div>
        ) : (
          <div className="selected-file">
            <FileText size={30} />

            <div className="file-details">
              <strong>{file.name}</strong>
              <span>
                {(file.size / (1024 * 1024)).toFixed(2)} MB
              </span>
            </div>

            <button
              type="button"
              className="remove-file"
              disabled={disabled}
              aria-label="Remove document"
              onClick={(event) => {
                event.stopPropagation();
                onFileSelect(null);
                setError("");
              }}
            >
              <X size={19} />
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
