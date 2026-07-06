import express from "express";
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";

const app = express();
app.use(express.json({ limit: "50mb" }));

const client = new AnthropicBedrock({
  awsRegion: process.env.AWS_REGION || "us-east-1",
});

const FAST_MODEL = "us.anthropic.claude-sonnet-4-6";
const REASONING_MODEL = "us.anthropic.claude-opus-4-8";

const coursebookSchema = {
  type: "object" as const,
  properties: {
    title: { type: "string" as const },
    level: { type: "string" as const },
    publisher: { type: "string" as const },
    units: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          unitNumber: { type: "string" as const },
          title: { type: "string" as const },
          grammar: {
            type: "array" as const,
            items: {
              type: "object" as const,
              properties: {
                item: { type: "string" as const },
                description: { type: "string" as const },
              },
              required: ["item"],
            },
          },
          vocabulary: {
            type: "array" as const,
            items: {
              type: "object" as const,
              properties: {
                topic: { type: "string" as const },
                items: { type: "array" as const, items: { type: "string" as const } },
              },
              required: ["topic", "items"],
            },
          },
          topics: { type: "array" as const, items: { type: "string" as const } },
        },
        required: ["unitNumber", "title", "grammar", "vocabulary", "topics"],
      },
    },
  },
  required: ["title", "units"],
};

app.post("/api/analyze-image", async (req, res) => {
  const { base64Data, mimeType, fileName } = req.body;

  const data = base64Data.includes(",")
    ? base64Data.split(",")[1]
    : base64Data;

  const isPdf = mimeType === "application/pdf";

  const fileBlock = isPdf
    ? {
        type: "document" as const,
        source: {
          type: "base64" as const,
          media_type: "application/pdf" as const,
          data,
        },
      }
    : {
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data,
        },
      };

  try {
    const response = await client.messages.create({
      model: FAST_MODEL,
      max_tokens: 4096,
      tools: [
        {
          name: "extract_coursebook",
          description:
            "Extract structured coursebook data from the analyzed content page.",
          input_schema: coursebookSchema,
        },
      ],
      tool_choice: { type: "tool", name: "extract_coursebook" },
      messages: [
        {
          role: "user",
          content: [
            fileBlock,
            {
              type: "text",
              text: `Analyze this coursebook content page. Extract the didactic units, including their unit number/title, grammar items, vocabulary sets, and main topics.${fileName ? ` NOTE: The coursebook title should be "${fileName}" if you cannot find a more specific one on the page.` : ""}`,
            },
          ],
        },
      ],
    });

    const toolBlock = response.content.find((b) => b.type === "tool_use");
    if (toolBlock && toolBlock.type === "tool_use") {
      res.json(toolBlock.input);
    } else {
      res.status(500).json({ error: "No structured output returned" });
    }
  } catch (error: any) {
    console.error("Image analysis failed:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/analyze-excel", async (req, res) => {
  const { jsonData } = req.body;

  try {
    const response = await client.messages.create({
      model: FAST_MODEL,
      max_tokens: 8192,
      tools: [
        {
          name: "extract_coursebooks",
          description:
            "Extract an array of structured coursebook objects from the Excel data.",
          input_schema: {
            type: "object" as const,
            properties: {
              coursebooks: {
                type: "array" as const,
                items: coursebookSchema,
              },
            },
            required: ["coursebooks"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "extract_coursebooks" },
      messages: [
        {
          role: "user",
          content: `Analyze this JSON data extracted from an Excel file containing multiple English coursebook syllabi. Each coursebook should have a title, level, and units with grammar, vocabulary, and topics.\n\nIMPORTANT: The coursebook title for each row or section should be taken from "Column A" (which is usually the first property in each object).\n\nData:\n${JSON.stringify(jsonData, null, 2)}`,
        },
      ],
    });

    const toolBlock = response.content.find((b) => b.type === "tool_use");
    if (toolBlock && toolBlock.type === "tool_use") {
      res.json((toolBlock.input as any).coursebooks);
    } else {
      res.status(500).json({ error: "No structured output returned" });
    }
  } catch (error: any) {
    console.error("Excel analysis failed:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/compare", async (req, res) => {
  const { coursebooks } = req.body;

  try {
    const response = await client.messages.create({
      model: REASONING_MODEL,
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: `Compare the following English coursebooks, focusing EXCLUSIVELY on grammar points:
${JSON.stringify(coursebooks, null, 2)}

CRITICAL INSTRUCTIONS:
1. Focus ONLY on grammar items. Do NOT include vocabulary themes, vocabulary sets, or general topics.
2. When referencing a grammar item from a coursebook, you MUST provide the Unit number or title in which it is found (e.g., "[Book Title] - Unit 3: [Grammar Item]").
3. Do NOT provide a suggested optimized syllabus (no Section 5).
4. Use a clear Markdown format with tables or lists.

Identify:
1. Common grammar items across all or most books. For each item, list every book that contains it and the specific Unit where it appears.
2. Unique grammar items found in only one specific book. Identify the book and the Unit for each.

Provide a detailed comparative analysis of the grammar syllabi in Markdown format.`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    res.json({ result: textBlock && textBlock.type === "text" ? textBlock.text : "No analysis generated." });
  } catch (error: any) {
    console.error("Comparison failed:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/compare-benchmark", async (req, res) => {
  const { benchmark, coursebooks } = req.body;

  try {
    const response = await client.messages.create({
      model: REASONING_MODEL,
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: `Analyze and compare the following English coursebooks against the designated Benchmark Syllabus, focusing EXCLUSIVELY on grammar points:

BENCHMARK SYLLABUS:
${JSON.stringify(benchmark, null, 2)}

COMPARED COURSEBOOKS:
${JSON.stringify(coursebooks, null, 2)}

CRITICAL INSTRUCTIONS:
1. Focus ONLY on grammar items. Do NOT include vocabulary themes, vocabulary sets, or general topics.
2. When referencing any grammar item, always indicate the specific Unit number/title in which it is found in both the Benchmark and the compared books.
3. For each compared coursebook, analyze:
   a. Alignment: How closely does the coursebook align with the Benchmark's progression and unit structure?
   b. Covered Grammar: Which benchmark grammar points are included in the coursebook (with specific unit numbers)?
   c. Gaps / Missing Grammar: Which benchmark grammar points are entirely missing from this coursebook?
   d. Extraneous Grammar: Which grammar points are covered in this coursebook that are NOT specified in the Benchmark Syllabus?
4. Synthesize the findings into clear Markdown. Use comparison tables, percentage estimates of coverage, or side-by-side lists under dedicated markdown headers to make the insights clear and actionable for curriculum developers.

Provide a highly detailed Benchmark Alignment and Gap Analysis in Markdown format. Do not include vocabulary items.`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    res.json({ result: textBlock && textBlock.type === "text" ? textBlock.text : "No analysis generated." });
  } catch (error: any) {
    console.error("Benchmark comparison failed:", error.message);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
