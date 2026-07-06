import { Coursebook } from "../types";

const API_BASE = "/api";

export async function analyzeCoursebookImage(
  base64Data: string,
  mimeType: string,
  fileName?: string
): Promise<Coursebook> {
  const response = await fetch(`${API_BASE}/analyze-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonData }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Excel analysis failed");
  }

  const results = await response.json();
  return results.map((result: any) => ({ id: crypto.randomUUID(), ...result }));
}

export async function compareCoursebooks(coursebooks: Coursebook[]): Promise<string> {
  const response = await fetch(`${API_BASE}/compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ benchmark, coursebooks }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Benchmark comparison failed");
  }

  const data = await response.json();
  return data.result;
}
