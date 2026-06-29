/**
 * Trigger a file download in the browser.
 * Uses a temporary <a download> element — no popup blockers.
 */
export function downloadUrl(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Trigger a file download from an in-memory Blob.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  downloadUrl(url, filename);
  // Revoke after a short delay so the download has time to start
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
