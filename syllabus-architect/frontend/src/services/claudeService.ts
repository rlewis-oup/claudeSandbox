import { Coursebook } from "../types";
import { getToken } from "../auth";

const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : "/api";

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function analyzeCoursebookImage(
  base64Data: string,
  mimeType: string,
  fileName?: string
): Promise<Coursebook> {
  const response = await fetch(`${API_BASE}/analyze-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ base64Data, mimeType, fileName }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Image analysis failed");
  }

  const result = await response.json();
  return { id: crypto.randomUUID(), ...result };
}

export async function analyzeCoursebookExcel(jsonData: any): Promise<Coursebook[]> {
  const response = await fetch(`${API_BASE}/analyze-excel`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ jsonData }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Excel analysis failed");
  }

  const results = await response.json();
  return results.map((result: any) => ({ id: crypto.randomUUID(), ...result }));
}

async function safeErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    try {
      const json = JSON.parse(text);
      return json.error || json.detail || text;
    } catch {
      return text || `HTTP ${response.status}`;
    }
  } catch {
    return `HTTP ${response.status}`;
  }
}

export async function analyzeFullPdf(
  fileData: File | Blob | string,
  fileName?: string
): Promise<Coursebook> {
  // Step 1: Get presigned upload URL
  const urlResp = await fetch(`${API_BASE}/get-upload-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ fileName: fileName || "coursebook.pdf" }),
  });

  if (!urlResp.ok) {
    const msg = await safeErrorBody(urlResp);
    throw new Error(`Failed to get upload URL: ${msg}`);
  }

  const { uploadUrl, s3Key } = await urlResp.json();

  // Step 2: Upload PDF to S3 via presigned URL
  let pdfBlob: Blob;
  if (fileData instanceof Blob) {
    pdfBlob = fileData;
  } else {
    const byteString = atob(
      typeof fileData === "string" && fileData.includes(",")
        ? fileData.split(",")[1]
        : (fileData as string)
    );
    const bytes = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) {
      bytes[i] = byteString.charCodeAt(i);
    }
    pdfBlob = new Blob([bytes], { type: "application/pdf" });
  }

  try {
    const uploadResp = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
      body: pdfBlob,
    });

    if (!uploadResp.ok) {
      throw new Error(`S3 upload failed with status ${uploadResp.status}`);
    }
  } catch (e: any) {
    if (e.message?.includes("S3 upload failed")) throw e;
    throw new Error(
      `Failed to upload PDF to S3 (possible CORS issue). Check browser console for details.`
    );
  }

  // Step 3: Analyze the uploaded PDF (long-running — up to 10 minutes)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 600_000);

  try {
    const response = await fetch(`${API_BASE}/analyze-full-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ s3Key, fileName }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const msg = await safeErrorBody(response);
      throw new Error(`PDF analysis failed: ${msg}`);
    }

    const result = await response.json();
    return { id: crypto.randomUUID(), ...result };
  } catch (e: any) {
    if (e.name === "AbortError") {
      throw new Error("PDF analysis timed out after 10 minutes. The file may be too large.");
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

export async function compareCoursebooks(coursebooks: Coursebook[]): Promise<string> {
  const response = await fetch(`${API_BASE}/compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ coursebooks }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Comparison failed");
  }

  const data = await response.json();
  return data.result;
}

export async function compareWithBenchmark(
  benchmark: Coursebook,
  coursebooks: Coursebook[]
): Promise<string> {
  const response = await fetch(`${API_BASE}/compare-benchmark`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ benchmark, coursebooks }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Benchmark comparison failed");
  }

  const data = await response.json();
  return data.result;
}
