import base64
import io
import json
import os
import uuid
from typing import Annotated

import anthropic
import boto3
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pypdf import PdfReader, PdfWriter

from api.deps import get_user_id

router = APIRouter(prefix="/api")

client = anthropic.AnthropicBedrock(aws_region=os.environ.get("AWS_REGION", "us-east-1"))
s3_client = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-east-1"))
UPLOAD_BUCKET = os.environ.get("UPLOAD_BUCKET", "")

FAST_MODEL = "us.anthropic.claude-sonnet-4-6"
REASONING_MODEL = "us.anthropic.claude-opus-4-8"

COURSEBOOK_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "level": {"type": "string"},
        "publisher": {"type": "string"},
        "units": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "unitNumber": {"type": "string"},
                    "title": {"type": "string"},
                    "grammar": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "item": {"type": "string"},
                                "description": {"type": "string"},
                            },
                            "required": ["item"],
                        },
                    },
                    "vocabulary": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "topic": {"type": "string"},
                                "items": {"type": "array", "items": {"type": "string"}},
                            },
                            "required": ["topic", "items"],
                        },
                    },
                    "topics": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["unitNumber", "title", "grammar", "vocabulary", "topics"],
            },
        },
    },
    "required": ["title", "units"],
}


@router.get("/health")
def health():
    return {"status": "ok"}


@router.post("/get-upload-url")
async def get_upload_url(request: Request, user_id: Annotated[str, Depends(get_user_id)]):
    body = await request.json()
    file_name = body.get("fileName", "upload.pdf")
    s3_key = f"uploads/{uuid.uuid4()}/{file_name}"

    presigned_url = s3_client.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": UPLOAD_BUCKET,
            "Key": s3_key,
            "ContentType": "application/pdf",
        },
        ExpiresIn=600,
    )

    return JSONResponse(content={"uploadUrl": presigned_url, "s3Key": s3_key})


@router.post("/analyze-image")
async def analyze_image(request: Request, user_id: Annotated[str, Depends(get_user_id)]):
    body = await request.json()
    base64_data = body["base64Data"]
    mime_type = body["mimeType"]
    file_name = body.get("fileName")

    data = base64_data.split(",")[1] if "," in base64_data else base64_data
    is_pdf = mime_type == "application/pdf"

    if is_pdf:
        file_block = {
            "type": "document",
            "source": {"type": "base64", "media_type": "application/pdf", "data": data},
        }
    else:
        file_block = {
            "type": "image",
            "source": {"type": "base64", "media_type": mime_type, "data": data},
        }

    prompt = "Analyze this coursebook content page. Extract the didactic units, including their unit number/title, grammar items, vocabulary sets, and main topics."
    if file_name:
        prompt += f' NOTE: The coursebook title should be "{file_name}" if you cannot find a more specific one on the page.'

    try:
        response = client.messages.create(
            model=FAST_MODEL,
            max_tokens=4096,
            tools=[
                {
                    "name": "extract_coursebook",
                    "description": "Extract structured coursebook data from the analyzed content page.",
                    "input_schema": COURSEBOOK_SCHEMA,
                }
            ],
            tool_choice={"type": "tool", "name": "extract_coursebook"},
            messages=[
                {"role": "user", "content": [file_block, {"type": "text", "text": prompt}]}
            ],
        )

        for block in response.content:
            if block.type == "tool_use":
                return JSONResponse(content=block.input)

        return JSONResponse(status_code=500, content={"error": "No structured output returned"})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


ACTIVITY_COUNTS_SCHEMA = {
    "type": "object",
    "description": "Number of distinct activities/exercises in this unit, broken down by skill focus",
    "properties": {
        "grammar": {"type": "integer", "description": "Activities focused on grammar practice"},
        "vocabulary": {"type": "integer", "description": "Activities focused on vocabulary"},
        "reading": {"type": "integer", "description": "Reading comprehension activities"},
        "listening": {"type": "integer", "description": "Listening comprehension activities"},
        "speaking": {"type": "integer", "description": "Speaking/conversation activities"},
        "writing": {"type": "integer", "description": "Writing activities"},
        "total": {"type": "integer", "description": "Total number of activities in this unit"},
    },
    "required": ["grammar", "vocabulary", "reading", "listening", "speaking", "writing", "total"],
}

FULL_COURSEBOOK_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string", "description": "The title of the coursebook"},
        "level": {"type": "string", "description": "The CEFR or proficiency level (e.g. A1, B2, Elementary)"},
        "publisher": {"type": "string", "description": "The publisher of the coursebook"},
        "units": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "unitNumber": {"type": "string", "description": "Unit number or identifier (e.g. '1', 'Starter', 'A')"},
                    "title": {"type": "string", "description": "Title of the unit"},
                    "theme": {"type": "string", "description": "The overarching theme or topic of this unit (e.g. 'Travel', 'Family', 'Technology')"},
                    "lessons": {
                        "type": "array",
                        "description": "Individual lessons within this unit",
                        "items": {
                            "type": "object",
                            "properties": {
                                "lessonNumber": {"type": "string", "description": "Lesson identifier within the unit"},
                                "title": {"type": "string", "description": "Lesson title"},
                                "grammar": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "item": {"type": "string", "description": "The grammar point taught"},
                                            "description": {"type": "string", "description": "Brief description of how it is presented"},
                                        },
                                        "required": ["item"],
                                    },
                                },
                            },
                            "required": ["lessonNumber", "title", "grammar"],
                        },
                    },
                    "grammar": {
                        "type": "array",
                        "description": "All grammar points taught in this unit (aggregated across lessons)",
                        "items": {
                            "type": "object",
                            "properties": {
                                "item": {"type": "string"},
                                "description": {"type": "string"},
                            },
                            "required": ["item"],
                        },
                    },
                    "vocabulary": {
                        "type": "array",
                        "description": "Vocabulary actively PRESENTED or TAUGHT in this unit (via exercises, vocabulary boxes, or presentation activities). Exclude word lists, glossaries, and reference sections.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "topic": {"type": "string"},
                                "items": {"type": "array", "items": {"type": "string"}},
                            },
                            "required": ["topic", "items"],
                        },
                    },
                    "lexicalItemCount": {"type": "integer", "description": "Number of vocabulary items actively PRESENTED or TAUGHT in this unit (in vocabulary exercises, labelled vocabulary boxes, or presentation activities). EXCLUDE word lists, glossaries, reference sections, and appendix entries — only count items that are part of explicit vocabulary instruction."},
                    "topics": {"type": "array", "items": {"type": "string"}},
                    "activityCounts": ACTIVITY_COUNTS_SCHEMA,
                    "additionalFeatures": {
                        "type": "array",
                        "description": "Any other labelled features, skills, or sections in the unit (e.g. 'Pronunciation', 'Culture note', 'Practical English', 'Review', 'Video', 'Project', 'CLIL', 'Exam practice')",
                        "items": {"type": "string"},
                    },
                },
                "required": ["unitNumber", "title", "grammar", "vocabulary", "topics"],
            },
        },
    },
    "required": ["title", "units"],
}


MAX_PDF_PAGES = 40


def _split_pdf(pdf_bytes: bytes) -> list[bytes]:
    """Split a PDF into chunks of MAX_PDF_PAGES pages. Returns list of PDF byte strings."""
    reader = PdfReader(io.BytesIO(pdf_bytes))
    total_pages = len(reader.pages)

    if total_pages <= MAX_PDF_PAGES:
        return [pdf_bytes]

    chunks = []
    for start in range(0, total_pages, MAX_PDF_PAGES):
        writer = PdfWriter()
        end = min(start + MAX_PDF_PAGES, total_pages)
        for i in range(start, end):
            writer.add_page(reader.pages[i])
        buf = io.BytesIO()
        writer.write(buf)
        chunks.append(buf.getvalue())
    return chunks


def _analyze_pdf_chunk(data_b64: str, file_name: str, chunk_index: int, total_chunks: int) -> dict:
    """Send a single PDF chunk to Claude and return the structured result."""
    file_block = {
        "type": "document",
        "source": {"type": "base64", "media_type": "application/pdf", "data": data_b64},
    }

    if total_chunks == 1:
        context = "You are analyzing a COMPLETE English language coursebook PDF."
    else:
        context = (
            f"You are analyzing PART {chunk_index + 1} of {total_chunks} of an English language coursebook PDF. "
            f"This section contains pages {chunk_index * MAX_PDF_PAGES + 1} onwards."
        )

    prompt = f"""{context} Your task is to thoroughly
read this document and extract a comprehensive syllabus analysis.

INSTRUCTIONS:
1. Identify the coursebook title, level (CEFR if possible), and publisher from the cover/title pages (if visible in this section).
2. Map the complete structure: identify ALL units visible in this section from beginning to end.
3. Within each unit, identify individual lessons or sections.
4. For each lesson, extract ALL grammar points that are explicitly taught or practised.
5. For each unit, extract:
   a. **Theme**: The overarching theme or topic (e.g. "Travel", "Family", "Technology").
   b. **Grammar**: All grammar points taught, aggregated across lessons.
   c. **Vocabulary**: Lexical groups/sets that are actively PRESENTED or TAUGHT (in vocabulary exercises, labelled vocabulary boxes, or presentation activities). Do NOT include word lists, glossaries, or reference sections — only vocabulary that is part of explicit instruction.
   d. **Lexical item count**: Count ONLY vocabulary items that are actively presented/taught in exercises or vocabulary sections. EXCLUDE word lists, glossaries, reference appendices, and any items that appear only as passive reference material.
   e. **Activity counts**: Count distinct activities/exercises and categorise them as grammar, vocabulary, reading, listening, speaking, or writing. Provide a total as well.
   f. **Additional features**: Any other labelled sections or skills (e.g. "Pronunciation", "Culture note", "Practical English", "Review", "Video", "Project", "CLIL", "Exam practice", "Song", "Game", "Phonics").

IMPORTANT:
- Be thorough — process the ENTIRE section, not just the first few pages or table of contents.
- If the book has a contents page, use it as a guide but verify against the actual unit content.
- Grammar points should be specific (e.g. "present simple: affirmative and negative", "comparatives with -er and more").
- If a grammar point appears in multiple lessons, note it in each lesson where it is explicitly taught.
- The unit-level grammar array should be the aggregation of all grammar from the lessons in that unit.
- For activity counts, count each numbered exercise or labelled activity. If an activity covers multiple skills, assign it to its primary skill focus.
- CRITICAL for vocabulary: only count items that are ACTIVELY PRESENTED or TAUGHT (vocabulary exercises, labelled vocabulary boxes, vocabulary presentation sections). Do NOT count word lists, glossaries, back-of-book reference lists, or appendix entries. These are reference material, not vocabulary presentation.
- Use the filename "{file_name}" as the book title only if you cannot determine the actual title from the content.

Extract the complete structured syllabus for this section of the coursebook."""

    response = client.messages.create(
        model=FAST_MODEL,
        max_tokens=16384,
        tools=[
            {
                "name": "extract_full_coursebook",
                "description": "Extract the complete structured syllabus from a coursebook PDF section, including all units, lessons, and grammar points.",
                "input_schema": FULL_COURSEBOOK_SCHEMA,
            }
        ],
        tool_choice={"type": "tool", "name": "extract_full_coursebook"},
        messages=[
            {"role": "user", "content": [file_block, {"type": "text", "text": prompt}]}
        ],
    )

    for block in response.content:
        if block.type == "tool_use":
            return block.input
    return {}


def _merge_chunk_results(results: list[dict]) -> dict:
    """Merge multiple chunk analysis results into a single coursebook."""
    if len(results) == 1:
        return results[0]

    merged = {
        "title": "",
        "level": "",
        "publisher": "",
        "units": [],
    }

    seen_units: dict[str, dict] = {}

    for result in results:
        if not merged["title"] and result.get("title"):
            merged["title"] = result["title"]
        if not merged["level"] and result.get("level"):
            merged["level"] = result["level"]
        if not merged["publisher"] and result.get("publisher"):
            merged["publisher"] = result["publisher"]

        for unit in result.get("units", []):
            unit_key = unit.get("unitNumber", "")
            if unit_key in seen_units:
                existing = seen_units[unit_key]
                if not existing.get("theme") and unit.get("theme"):
                    existing["theme"] = unit["theme"]
                existing_grammar_items = {g["item"] for g in existing.get("grammar", [])}
                for g in unit.get("grammar", []):
                    if g["item"] not in existing_grammar_items:
                        existing["grammar"].append(g)
                        existing_grammar_items.add(g["item"])
                existing_lessons = {l.get("lessonNumber") for l in existing.get("lessons", [])}
                for lesson in unit.get("lessons", []):
                    if lesson.get("lessonNumber") not in existing_lessons:
                        existing.setdefault("lessons", []).append(lesson)
                existing_topics = set(existing.get("topics", []))
                for t in unit.get("topics", []):
                    if t not in existing_topics:
                        existing["topics"].append(t)
                existing_vocab_topics = {v["topic"] for v in existing.get("vocabulary", [])}
                for v in unit.get("vocabulary", []):
                    if v["topic"] not in existing_vocab_topics:
                        existing["vocabulary"].append(v)
                existing["lexicalItemCount"] = max(
                    existing.get("lexicalItemCount", 0), unit.get("lexicalItemCount", 0)
                )
                if unit.get("activityCounts"):
                    if not existing.get("activityCounts"):
                        existing["activityCounts"] = unit["activityCounts"]
                    else:
                        for k in ("grammar", "vocabulary", "reading", "listening", "speaking", "writing", "total"):
                            existing["activityCounts"][k] = max(
                                existing["activityCounts"].get(k, 0),
                                unit["activityCounts"].get(k, 0),
                            )
                existing_features = set(existing.get("additionalFeatures", []))
                for f in unit.get("additionalFeatures", []):
                    if f not in existing_features:
                        existing.setdefault("additionalFeatures", []).append(f)
                        existing_features.add(f)
            else:
                seen_units[unit_key] = unit
                merged["units"].append(unit)

    return merged


@router.post("/analyze-full-pdf")
async def analyze_full_pdf(request: Request, user_id: Annotated[str, Depends(get_user_id)]):
    body = await request.json()
    s3_key = body.get("s3Key")
    file_name = body.get("fileName", "Unknown Coursebook")

    if not s3_key:
        return JSONResponse(status_code=400, content={"error": "s3Key is required"})

    try:
        s3_response = s3_client.get_object(Bucket=UPLOAD_BUCKET, Key=s3_key)
        pdf_bytes = s3_response["Body"].read()
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": f"Failed to read PDF from S3: {e}"})
    finally:
        try:
            s3_client.delete_object(Bucket=UPLOAD_BUCKET, Key=s3_key)
        except Exception:
            pass

    try:
        chunks = _split_pdf(pdf_bytes)
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": f"Failed to read PDF file: {e}"})

    try:
        results = []
        for i, chunk in enumerate(chunks):
            data_b64 = base64.b64encode(chunk).decode("utf-8")
            result = _analyze_pdf_chunk(data_b64, file_name, i, len(chunks))
            if result:
                results.append(result)

        if not results:
            return JSONResponse(status_code=500, content={"error": "No structured output returned from any PDF section"})

        merged = _merge_chunk_results(results)
        return JSONResponse(content=merged)
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@router.post("/analyze-excel")
async def analyze_excel(request: Request, user_id: Annotated[str, Depends(get_user_id)]):
    body = await request.json()
    json_data = body["jsonData"]

    try:
        response = client.messages.create(
            model=FAST_MODEL,
            max_tokens=8192,
            tools=[
                {
                    "name": "extract_coursebooks",
                    "description": "Extract an array of structured coursebook objects from the Excel data.",
                    "input_schema": {
                        "type": "object",
                        "properties": {"coursebooks": {"type": "array", "items": COURSEBOOK_SCHEMA}},
                        "required": ["coursebooks"],
                    },
                }
            ],
            tool_choice={"type": "tool", "name": "extract_coursebooks"},
            messages=[
                {
                    "role": "user",
                    "content": (
                        "Analyze this JSON data extracted from an Excel file containing multiple English coursebook syllabi. "
                        "Each coursebook should have a title, level, and units with grammar, vocabulary, and topics.\n\n"
                        'IMPORTANT: The coursebook title for each row or section should be taken from "Column A" '
                        "(which is usually the first property in each object).\n\n"
                        f"Data:\n{json.dumps(json_data, indent=2)}"
                    ),
                }
            ],
        )

        for block in response.content:
            if block.type == "tool_use":
                return JSONResponse(content=block.input["coursebooks"])

        return JSONResponse(status_code=500, content={"error": "No structured output returned"})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@router.post("/compare")
async def compare(request: Request, user_id: Annotated[str, Depends(get_user_id)]):
    body = await request.json()
    coursebooks = body["coursebooks"]

    has_rich_data = any(
        unit.get("activityCounts") or unit.get("theme") or unit.get("additionalFeatures")
        for book in coursebooks
        for unit in book.get("units", [])
    )

    has_lessons = any(
        unit.get("lessons")
        for book in coursebooks
        for unit in book.get("units", [])
    )

    if has_rich_data:
        lesson_instruction = ""
        if has_lessons:
            lesson_instruction = """
- Where lesson-level data is available, reference the specific Unit AND Lesson for grammar items."""

        prompt = f"""Compare the following English coursebooks across ALL available dimensions:
{json.dumps(coursebooks, indent=2)}

Produce a comprehensive comparative analysis in Markdown with the following sections:

## 1. Grammar Syllabus Comparison
- Common grammar items across books (with unit references for each book).
- Unique grammar items found in only one book (with unit reference).
- Equivalent grammar topics (same or very similar grammar taught across books).
- Gaps — grammar present in some books but absent from others.{lesson_instruction}

## 2. Unit Theme Differentiation
- For each book, list every unit's theme.
- Compare thematic coverage: shared themes, unique themes, thematic sequencing differences.
- Present as a comparison table where possible.

## 3. Lexical / Vocabulary Comparison
- Compare vocabulary groups/topics across books (which lexical fields each book covers per unit).
- Compare lexical item counts per unit across books (present as a table).
- Identify which books introduce more vocabulary and where the gaps are.

## 4. Activity Profile Comparison
- For each book, present the activity count breakdown per unit (grammar, vocabulary, reading, listening, speaking, writing, total) as a table.
- Compare the overall skill emphasis of each book (e.g. one book may be heavier on grammar exercises, another on speaking).
- Highlight significant differences in activity volume or skill balance.

## 5. Additional Features & Skills
- List all additional labelled features found across books (e.g. Pronunciation, Culture note, Video, Project, CLIL, Exam practice, Review, Song, Phonics, etc.).
- Compare which books include which features (present as a feature matrix table).
- Note any unique or distinctive features per book.

CRITICAL INSTRUCTIONS:
- Always reference the specific Unit number when citing any item.
- Use Markdown tables where appropriate for clarity.
- Do NOT provide a suggested optimized syllabus.
- If data for a dimension is missing from a particular book, note that explicitly rather than omitting the book from the comparison."""

    else:
        lesson_instruction = ""
        if has_lessons:
            lesson_instruction = """
5. Where lesson-level data is available, present comparisons at BOTH the Unit level and the Lesson level.
   For each grammar item, reference the specific Unit AND Lesson (e.g., "[Book Title] - Unit 3, Lesson 2: [Grammar Item]").
6. Include a section identifying equivalent grammar topics (same grammar taught in different books), similar coverage (related grammar topics), gaps (grammar missing from one or more books), and unique content (grammar only found in one book)."""

        prompt = f"""Compare the following English coursebooks, focusing EXCLUSIVELY on grammar points:
{json.dumps(coursebooks, indent=2)}

CRITICAL INSTRUCTIONS:
1. Focus ONLY on grammar items. Do NOT include vocabulary themes, vocabulary sets, or general topics.
2. When referencing a grammar item from a coursebook, you MUST provide the Unit number or title in which it is found (e.g., "[Book Title] - Unit 3: [Grammar Item]").
3. Do NOT provide a suggested optimized syllabus (no Section 5).
4. Use a clear Markdown format with tables or lists.{lesson_instruction}

Identify:
1. Common grammar items across all or most books. For each item, list every book that contains it and the specific Unit where it appears.
2. Unique grammar items found in only one specific book. Identify the book and the Unit for each.
3. Equivalent grammar topics taught across different books (same or very similar grammar items).
4. Gaps in coverage — grammar items present in some books but absent from others.

Provide a detailed comparative analysis of the grammar syllabi in Markdown format."""

    try:
        response = client.messages.create(
            model=REASONING_MODEL,
            max_tokens=16384,
            messages=[{"role": "user", "content": prompt}],
        )

        for block in response.content:
            if block.type == "text":
                return JSONResponse(content={"result": block.text})

        return JSONResponse(content={"result": "No analysis generated."})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@router.post("/compare-benchmark")
async def compare_benchmark(request: Request, user_id: Annotated[str, Depends(get_user_id)]):
    body = await request.json()
    benchmark = body["benchmark"]
    coursebooks = body["coursebooks"]

    prompt = f"""Analyze and compare the following English coursebooks against the designated Benchmark Syllabus, focusing EXCLUSIVELY on grammar points:

BENCHMARK SYLLABUS:
{json.dumps(benchmark, indent=2)}

COMPARED COURSEBOOKS:
{json.dumps(coursebooks, indent=2)}

CRITICAL INSTRUCTIONS:
1. Focus ONLY on grammar items. Do NOT include vocabulary themes, vocabulary sets, or general topics.
2. When referencing any grammar item, always indicate the specific Unit number/title in which it is found in both the Benchmark and the compared books.
3. For each compared coursebook, analyze:
   a. Alignment: How closely does the coursebook align with the Benchmark's progression and unit structure?
   b. Covered Grammar: Which benchmark grammar points are included in the coursebook (with specific unit numbers)?
   c. Gaps / Missing Grammar: Which benchmark grammar points are entirely missing from this coursebook?
   d. Extraneous Grammar: Which grammar points are covered in this coursebook that are NOT specified in the Benchmark Syllabus?
4. Synthesize the findings into clear Markdown. Use comparison tables, percentage estimates of coverage, or side-by-side lists under dedicated markdown headers to make the insights clear and actionable for curriculum developers.

Provide a highly detailed Benchmark Alignment and Gap Analysis in Markdown format. Do not include vocabulary items."""

    try:
        response = client.messages.create(
            model=REASONING_MODEL,
            max_tokens=8192,
            messages=[{"role": "user", "content": prompt}],
        )

        for block in response.content:
            if block.type == "text":
                return JSONResponse(content={"result": block.text})

        return JSONResponse(content={"result": "No analysis generated."})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})
