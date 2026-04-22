#!/usr/bin/env python3
"""
Test different Ollama Cloud models for Hindsight retain fact extraction.

Replicates the exact payload structure from the Hindsight API worker
and benchmarks candidate models for speed, JSON validity, and extraction quality.
"""

import json
import os
import sys
import time
from pathlib import Path

from openai import OpenAI

# ── Config ──────────────────────────────────────────────────────────────────

API_KEY = os.environ["OLLAMA_API_KEY"]
BASE_URL = "https://ollama.com/v1"

# Models to test — ordered by expected speed (fastest first)
CANDIDATE_MODELS = [
    "nemotron-3-super",
    "gemma3:27b",
    "gemma4:31b",
    "qwen3-coder-next",
    "mistral-large-3:675b",
    "minimax-m2.7",
    "minimax-m2.5",
    "gpt-oss:20b",
    "devstral-small-2:24b",
]

# Some models have lower max_tokens limits
MODEL_MAX_TOKENS = {
    "qwen3-coder-next": 32768,
}

# ── Payload (exact copy from Hindsight retain worker logs) ────────────────

SYSTEM_PROMPT = """Extract SIGNIFICANT facts from text. Be SELECTIVE - only extract facts worth remembering long-term.

LANGUAGE: MANDATORY — Detect the language of the input text and produce ALL output in that EXACT same language. You are STRICTLY FORBIDDEN from translating or switching to any other language. Every single word of your output must be in the same language as the input. Do NOT output in a different language under any circumstance.

══════════════════════════════════════════════════════════════════════════
FOCUS — What to retain for this bank
══════════════════════════════════════════════════════════════════════════

Extract all meaningful facts, decisions, preferences, and context. Ignore greetings, small talk, tool call mechanics, raw file content, and command output verbatim.

══════════════════════════════════════════════════════════════════════════
SELECTIVITY - CRITICAL (Reduces 90% of unnecessary output)
══════════════════════════════════════════════════════════════════════════

ONLY extract facts that are:
✅ Personal info: names, relationships, roles, background
✅ Preferences: likes, dislikes, habits, interests (e.g., "Alice likes coffee")
✅ Significant events: milestones, decisions, achievements, changes
✅ Plans/goals: future intentions, deadlines, commitments
✅ Expertise: skills, knowledge, certifications, experience
✅ Important context: projects, problems, constraints
✅ Sensory/emotional details: feelings, sensations, perceptions that provide context
✅ Observations: descriptions of people, places, things with specific details

DO NOT extract:
❌ Generic greetings: "how are you", "hello", pleasantries without substance
❌ Pure filler: "thanks", "sounds good", "ok", "got it", "sure"
❌ Process chatter: "let me check", "one moment", "I'll look into it"
❌ Repeated info: if already stated, don't extract again

CONSOLIDATE related statements into ONE fact when possible.

══════════════════════════════════════════════════════════════════════════
FACT FORMAT - BE CONCISE
══════════════════════════════════════════════════════════════════════════

1. **what**: Core fact - concise but complete (1-2 sentences max)
2. **when**: Temporal info if mentioned. "N/A" if none. Use day name when known.
3. **where**: Location if relevant. "N/A" if none.
4. **who**: People involved with relationships. "N/A" if just general info.
5. **why**: Context/significance ONLY if important. "N/A" if obvious.

CONCISENESS: Capture the essence, not every word. One good sentence beats three mediocre ones.

══════════════════════════════════════════════════════════════════════════
COREFERENCE RESOLUTION
══════════════════════════════════════════════════════════════════════════

Link generic references to names when both appear:
- "my roommate" + "Emily" → use "Emily (user's roommate)"
- "the manager" + "Sarah" → use "Sarah (the manager)"

══════════════════════════════════════════════════════════════════════════
CLASSIFICATION
══════════════════════════════════════════════════════════════════════════

fact_kind:
- "event": Specific datable occurrence (set occurred_start/end)
- "conversation": Ongoing state, preference, trait (no dates)

fact_type:
- "world": About other people, external events, general knowledge, objective facts
- "assistant": First-person actions, experiences, or observations by the speaker/author (e.g., "I changed X", "I discovered Y", "I debugged Z"). Also includes interactions with the user (requests, recommendations). If the narrator describes something they did, tried, learned, or decided — use "assistant".

══════════════════════════════════════════════════════════════════════════
TEMPORAL HANDLING
══════════════════════════════════════════════════════════════════════════

Use "Event Date" from input as reference for relative dates.
- CRITICAL: Convert ALL relative temporal expressions to absolute dates in the fact text itself.
  "yesterday" → write the resolved date (e.g. "on November 12, 2024"), NOT the word "yesterday"
  "last night", "this morning", "today", "tonight" → convert to the resolved absolute date
- For events: set occurred_start AND occurred_end (same for point events)
- For conversation facts: NO occurred dates

══════════════════════════════════════════════════════════════════════════
ENTITIES
══════════════════════════════════════════════════════════════════════════

Include: people names, organizations, places, key objects, abstract concepts (career, friendship, etc.)
Always include "user" when fact is about the user.

══════════════════════════════════════════════════════════════════════════
EXAMPLES (shown in English for illustration; for non-English input, ALL output values MUST be in the input language)
══════════════════════════════════════════════════════════════════════════

Example 1 - Selective extraction (Event Date: June 10, 2024):
Input: "Hey! How's it going? Good morning! So I'm planning my wedding - want a small outdoor ceremony. Just got back from Emily's wedding, she married Sarah at a rooftop garden. It was nice weather. I grabbed a coffee on the way."

Output: ONLY 2 facts (skip greetings, weather, coffee):
1. what="User planning wedding, wants small outdoor ceremony", who="user", why="N/A", entities=["user", "wedding"]
2. what="Emily married Sarah at rooftop garden", who="Emily (user's friend), Sarah", occurred_start="2024-06-09", entities=["Emily", "Sarah", "wedding"]

Example 2 - Professional context:
Input: "Alice has 5 years of Kubernetes experience and holds CKA certification. She's been leading the infrastructure team since March. By the way, she prefers dark roast coffee."

Output: ONLY 2 facts (skip coffee preference - too trivial):
1. what="Alice has 5 years Kubernetes experience, CKA certified", who="Alice", entities=["Alice", "Kubernetes", "CKA"]
2. what="Alice leads infrastructure team since March", who="Alice", entities=["Alice", "infrastructure"]

══════════════════════════════════════════════════════════════════════════
QUALITY OVER QUANTITY
══════════════════════════════════════════════════════════════════════════

Ask: "Would this be useful to recall in 6 months?" If no, skip it.

IMPORTANT: Sensory/emotional details and observations that provide meaningful context
about experiences ARE important to remember, even if they seem small (e.g., how food
tasted, how someone looked, how loud music was). Extract these if they characterize
an experience or person.

══════════════════════════════════════════════════════════════════════════
CAUSAL RELATIONSHIPS
══════════════════════════════════════════════════════════════════════════

Link facts with causal_relations (max 2 per fact). target_index must be < this fact's index.
Type: "caused_by" (this fact was caused by the target fact)

Example: "Lost job → couldn't pay rent → moved apartment"
- Fact 0: Lost job, causal_relations: null
- Fact 1: Couldn't pay rent, causal_relations: [{target_index: 0, relation_type: "caused_by"}]
- Fact 2: Moved apartment, causal_relations: [{target_index: 1, relation_type: "caused_by"}]

You must respond with valid JSON matching this schema:
{
  "$defs": {
    "Entity": {
      "description": "An entity extracted from text.",
      "properties": {
        "text": {
          "description": "The specific, named entity as it appears in the fact. Must be a proper noun or specific identifier.",
          "title": "Text",
          "type": "string"
        }
      },
      "required": ["text"],
      "title": "Entity",
      "type": "object"
    },
    "ExtractedFact": {
      "description": "A single extracted fact.",
      "properties": {
        "what": {
          "description": "Core fact - concise but complete (1-2 sentences)",
          "title": "What",
          "type": "string"
        },
        "when": {
          "description": "When it happened. 'N/A' if unknown.",
          "title": "When",
          "type": "string"
        },
        "where": {
          "description": "Location if relevant. 'N/A' if none.",
          "title": "Where",
          "type": "string"
        },
        "who": {
          "description": "People involved with relationships. 'N/A' if general.",
          "title": "Who",
          "type": "string"
        },
        "why": {
          "description": "Context/significance if important. 'N/A' if obvious.",
          "title": "Why",
          "type": "string"
        },
        "fact_kind": {
          "default": "conversation",
          "description": "'event' or 'conversation'",
          "title": "Fact Kind",
          "type": "string"
        },
        "occurred_start": {
          "anyOf": [{"type": "string"}, {"type": "null"}],
          "default": null,
          "description": "ISO timestamp for events",
          "title": "Occurred Start"
        },
        "occurred_end": {
          "anyOf": [{"type": "string"}, {"type": "null"}],
          "default": null,
          "description": "ISO timestamp for event end",
          "title": "Occurred End"
        },
        "fact_type": {
          "description": "'world' = objective/external facts. 'assistant' = first-person actions, experiences, or observations by the speaker.",
          "enum": ["world", "assistant"],
          "title": "Fact Type",
          "type": "string"
        },
        "entities": {
          "anyOf": [
            {"items": {"$ref": "#/$defs/Entity"}, "type": "array"},
            {"type": "null"}
          ],
          "default": null,
          "description": "People, places, concepts",
          "title": "Entities"
        },
        "causal_relations": {
          "anyOf": [
            {"items": {"$ref": "#/$defs/FactCausalRelation"}, "type": "array"},
            {"type": "null"}
          ],
          "default": null,
          "description": "Links to previous facts (target_index < this fact's index)",
          "title": "Causal Relations"
        }
      },
      "required": ["what", "when", "where", "who", "why", "fact_type"],
      "title": "ExtractedFact",
      "type": "object"
    },
    "FactCausalRelation": {
      "description": "Causal relationship from this fact to a PREVIOUS fact (embedded in each fact).\\n\\nUses index-based references but ONLY allows referencing facts that appear\\nBEFORE this fact in the list. This prevents hallucination of invalid indices.",
      "properties": {
        "target_index": {
          "description": "Index of the PREVIOUS fact this relates to (0-based). MUST be less than this fact's position in the list. Example: if this is fact #5, target_index can only be 0, 1, 2, 3, or 4.",
          "title": "Target Index",
          "type": "integer"
        },
        "relation_type": {
          "const": "caused_by",
          "description": "How this fact relates to the target fact: 'caused_by' = this fact was caused by the target fact",
          "title": "Relation Type",
          "type": "string"
        },
        "strength": {
          "default": 1.0,
          "description": "Strength of relationship (0.0 to 1.0). 1.0 = strong, 0.5 = moderate",
          "maximum": 1.0,
          "minimum": 0.0,
          "title": "Strength",
          "type": "number"
        }
      },
      "required": ["target_index", "relation_type"],
      "title": "FactCausalRelation",
      "type": "object"
    }
  },
  "description": "Response containing all extracted facts (causal relations are embedded in each fact).",
  "properties": {
    "facts": {
      "description": "List of extracted factual statements",
      "items": {"$ref": "#/$defs/ExtractedFact"},
      "title": "Facts",
      "type": "array"
    }
  },
  "required": ["facts"],
  "title": "FactExtractionResponse",
  "type": "object"
}"""

# Test input texts — realistic Hindsight retain scenarios
TEST_INPUTS = [
    {
        "name": "Korean conversation (typical)",
        "text": """오늘 점심에 김치찌개 먹었는데 진짜 맛있었어. 회사 근처 '할매김치'라는 식당인데 10년 넘게 했다는 서울 종로구에 있는 곳이야. 내일은 프로젝트 데드라인이라서 야근할 것 같아. 백엔드 API 리팩토링 마무리해야 하는데 아직 인증 모듈이 남았어. 팀장인 박과장님이 금요일까지 끝내라고 했어.""",
        "event_date": "2026-04-22",
    },
    {
        "name": "Technical context (English)",
        "text": """I just finished setting up the Hindsight retain pipeline. The key config is: we're using gemini-3-flash-preview via Ollama Cloud for fact extraction, with structured JSON output and temperature 0.1. The system prompt is about 2000 tokens long. We had issues with 500 errors from the Ollama Cloud API, so we're considering switching to a more reliable model. The PostgreSQL database uses vchord for vector search, and we're running BAAI/bge-m3 for embeddings locally.""",
        "event_date": "2026-04-22",
    },
    {
        "name": "Mixed content (Korean + English terms)",
        "text": """새 프로젝트 시작했어. React Native로 모바일 앱 개발하는 건데, 클라이언트는 '네이버'야. 백엔드는 NestJS 쓰기로 했고, DB는 PostgreSQL. 팀원은 총 4명인데, 디자이너 이수진, 프론트엔드 김도현, 백엔드 나, 그리고 PM 최윤정. 스프린트는 2주 단위로 돌아가고, 첫 배포 목표는 6월 말이야.""",
        "event_date": "2026-04-22",
    },
]


def build_user_message(test_input: dict) -> str:
    """Build the user message exactly like Hindsight retain worker does."""
    event_date_str = test_input["event_date"]
    from datetime import datetime

    dt = datetime.fromisoformat(event_date_str + "T12:00:00+00:00")
    event_date_display = dt.strftime("%A, %B %d, %Y")

    return (
        f"Extract facts from the following text chunk.\n\n"
        f"Chunk: 1/1\n"
        f"Event Date: {event_date_display} ({dt.isoformat()})\n"
        f"Context: none\n"
        f'Narrator: openclaw (AI agent — first-person statements like "I did X" are the agent\'s own actions; classify as "assistant")\n\n'
        f"Text:\n{test_input['text']}"
    )


import re


def _strip_code_fences(content: str) -> str:
    """Strip markdown code fences from LLM response if present.

    Mirrors Hindsight's openai_compatible_llm._strip_code_fences().
    """
    if "```" not in content:
        return content
    try:
        if "```json" in content:
            return content.split("```json")[1].split("```")[0].strip()
        return content.split("```")[1].split("```")[0].strip()
    except IndexError, ValueError:
        return content


def _strip_thinking(content: str) -> str:
    """Strip reasoning/thinking tags from LLM response.

    Mirrors Hindsight's thinking tag stripping logic.
    """
    if not content:
        return content
    original_len = len(content)
    content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL)
    content = re.sub(r"<thinking>.*?</thinking>", "", content, flags=re.DOTALL)
    content = re.sub(r"<reasoning>.*?</reasoning>", "", content, flags=re.DOTALL)
    content = re.sub(r"\|startthink\|.*?\|endthink\|", "", content, flags=re.DOTALL)
    content = content.strip()
    return content


def parse_llm_json(content: str) -> tuple[dict | None, str]:
    """Parse LLM JSON response with Hindsight-compatible fallback logic.

    Returns (parsed_data, parse_method) where parse_method is one of:
    'direct', 'stripped_fences', 'stripped_thinking', 'stripped_both', 'failed'
    """
    if not content:
        return None, "failed"

    # Try direct parse first
    try:
        return json.loads(content), "direct"
    except json.JSONDecodeError:
        pass

    # Strip thinking tags then try
    stripped_thinking = _strip_thinking(content)
    if stripped_thinking != content:
        try:
            return json.loads(stripped_thinking), "stripped_thinking"
        except json.JSONDecodeError:
            pass

    # Strip code fences then try
    stripped_fences = _strip_code_fences(content)
    if stripped_fences != content:
        try:
            return json.loads(stripped_fences), "stripped_fences"
        except json.JSONDecodeError:
            pass

    # Strip both
    stripped_both = _strip_code_fences(_strip_thinking(content))
    if stripped_both != content:
        try:
            return json.loads(stripped_both), "stripped_both"
        except json.JSONDecodeError:
            pass

    return None, "failed"


def validate_facts(data: dict) -> dict:
    """Validate the structure and quality of extracted facts."""
    issues = []

    if "facts" not in data:
        return {"valid": False, "issues": ["Missing 'facts' key"], "fact_count": 0}

    facts = data["facts"]
    if not isinstance(facts, list):
        return {"valid": False, "issues": ["'facts' is not a list"], "fact_count": 0}

    fact_count = len(facts)
    required_fields = ["what", "when", "where", "who", "why", "fact_type"]

    for i, fact in enumerate(facts):
        for field in required_fields:
            if field not in fact:
                issues.append(f"Fact {i}: missing '{field}'")

        if "fact_type" in fact and fact["fact_type"] not in ("world", "assistant"):
            issues.append(f"Fact {i}: invalid fact_type '{fact.get('fact_type')}'")

        if "fact_kind" in fact and fact["fact_kind"] not in ("event", "conversation"):
            issues.append(f"Fact {i}: invalid fact_kind '{fact.get('fact_kind')}'")

        # Check entities format
        if "entities" in fact and fact["entities"] is not None:
            for j, ent in enumerate(fact["entities"]):
                if isinstance(ent, dict):
                    if "text" not in ent:
                        issues.append(f"Fact {i} entity {j}: missing 'text'")
                elif isinstance(ent, str):
                    # Old format - just strings, still acceptable
                    pass
                else:
                    issues.append(f"Fact {i} entity {j}: unexpected type {type(ent)}")

        # Check causal_relations
        if "causal_relations" in fact and fact["causal_relations"] is not None:
            for j, rel in enumerate(fact["causal_relations"]):
                if "target_index" not in rel:
                    issues.append(f"Fact {i} causal_rel {j}: missing 'target_index'")
                if "relation_type" not in rel:
                    issues.append(f"Fact {i} causal_rel {j}: missing 'relation_type'")
                elif rel["relation_type"] != "caused_by":
                    issues.append(
                        f"Fact {i} causal_rel {j}: invalid relation_type '{rel['relation_type']}'"
                    )
                if "target_index" in rel and rel["target_index"] >= i:
                    issues.append(
                        f"Fact {i} causal_rel {j}: target_index {rel['target_index']} >= fact index {i}"
                    )

    return {
        "valid": len(issues) == 0,
        "issues": issues,
        "fact_count": fact_count,
    }


def test_model(client: OpenAI, model: str, test_input: dict) -> dict:
    """Test a single model with a single input."""
    user_msg = build_user_message(test_input)

    start = time.time()
    try:
        max_tokens = MODEL_MAX_TOKENS.get(model, 64000)
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
            temperature=0.1,
            timeout=60.0,
        )
        elapsed = time.time() - start

        content = response.choices[0].message.content
        usage = response.usage

        # Try to parse JSON with Hindsight-compatible fallback logic
        data, parse_method = parse_llm_json(content)
        if data is not None:
            validation = validate_facts(data)
        else:
            validation = {
                "valid": False,
                "issues": [
                    "JSON parse failed (tried: direct, stripped_fences, stripped_thinking, stripped_both)"
                ],
                "fact_count": 0,
            }
            # Log content preview for debugging
            if content:
                preview = content[:200] if len(content) > 200 else content
                validation["issues"].append(f"Content preview: {preview!r}")
            else:
                validation["issues"].append("Content is empty")

        return {
            "model": model,
            "test": test_input["name"],
            "elapsed_s": round(elapsed, 2),
            "input_tokens": usage.prompt_tokens if usage else None,
            "output_tokens": usage.completion_tokens if usage else None,
            "total_tokens": usage.total_tokens if usage else None,
            "json_valid": validation["valid"],
            "fact_count": validation["fact_count"],
            "issues": validation["issues"],
            "parse_method": parse_method,
            "data": data,
            "error": None,
        }

    except Exception as e:
        elapsed = time.time() - start
        return {
            "model": model,
            "test": test_input["name"],
            "elapsed_s": round(elapsed, 2),
            "input_tokens": None,
            "output_tokens": None,
            "total_tokens": None,
            "json_valid": False,
            "fact_count": 0,
            "issues": [],
            "parse_method": "failed",
            "data": None,
            "error": str(e),
        }


def print_result(result: dict):
    """Print a single test result."""
    status = "✅" if result["json_valid"] and result["error"] is None else "❌"
    parse_info = (
        f" (parse: {result['parse_method']})"
        if result["parse_method"] != "direct"
        else ""
    )
    print(f"\n{status} {result['model']} | {result['test']}{parse_info}")
    print(
        f"   Time: {result['elapsed_s']}s | Tokens: {result['input_tokens']}→{result['output_tokens']} ({result['total_tokens']} total)"
    )
    print(f"   JSON valid: {result['json_valid']} | Facts: {result['fact_count']}")

    if result["error"]:
        print(f"   ERROR: {result['error']}")
    if result["issues"]:
        for issue in result["issues"][:5]:
            print(f"   Issue: {issue}")
        if len(result["issues"]) > 5:
            print(f"   ... and {len(result['issues']) - 5} more issues")

    if result["data"] and result["json_valid"]:
        facts = result["data"].get("facts", [])
        for i, fact in enumerate(facts[:3]):
            what = fact.get("what", "?")[:80]
            ftype = fact.get("fact_type", "?")
            print(f"   Fact {i}: [{ftype}] {what}...")
        if len(facts) > 3:
            print(f"   ... and {len(facts) - 3} more facts")


def main():
    # Allow model override from CLI
    models = sys.argv[1:] if len(sys.argv) > 1 else CANDIDATE_MODELS

    client = OpenAI(api_key=API_KEY, base_url=BASE_URL)

    print("=" * 80)
    print("Hindsight Retain Model Benchmark")
    print("=" * 80)
    print(f"API: {BASE_URL}")
    print(f"Models: {', '.join(models)}")
    print(f"Tests: {len(TEST_INPUTS)} inputs")
    print("Max tokens: 64000 | Temperature: 0.1 | Response format: json_object")
    print("=" * 80)

    results = []

    for model in models:
        print(f"\n{'─' * 80}")
        print(f"🔍 Testing model: {model}")
        print(f"{'─' * 80}")

        for test_input in TEST_INPUTS:
            print(f"\n  → {test_input['name']}...", end="", flush=True)
            result = test_model(client, model, test_input)
            results.append(result)
            print_result(result)

    # Summary table
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"{'Model':<30} {'Time':>6} {'JSON':>5} {'Facts':>6} {'Error':>8}")
    print("-" * 80)

    # Group by model, show average time
    model_results = {}
    for r in results:
        if r["model"] not in model_results:
            model_results[r["model"]] = []
        model_results[r["model"]].append(r)

    for model in models:
        if model not in model_results:
            print(f"{model:<30} {'N/A':>6} {'N/A':>5} {'N/A':>6} {'MISSING':>8}")
            continue

        mresults = model_results[model]
        avg_time = sum(r["elapsed_s"] for r in mresults) / len(mresults)
        all_valid = all(r["json_valid"] for r in mresults)
        avg_facts = sum(r["fact_count"] for r in mresults) / len(mresults)
        has_error = any(r["error"] is not None for r in mresults)

        json_status = "✅" if all_valid else "❌"
        error_status = "ERROR" if has_error else "ok"

        print(
            f"{model:<30} {avg_time:>5.1f}s {json_status:>5} {avg_facts:>5.1f} {error_status:>8}"
        )

    print("\n" + "=" * 80)
    print(
        "RECOMMENDATION: Pick the fastest model with ✅ JSON validity and reasonable fact count"
    )
    print("=" * 80)

    # Save full results to JSON
    output_path = Path(__file__).parent / "retain_benchmark_results.json"
    # Remove 'data' field for serialization (can be large)
    serializable = []
    for r in results:
        r_copy = {k: v for k, v in r.items() if k != "data"}
        serializable.append(r_copy)

    output_path.write_text(json.dumps(serializable, indent=2, ensure_ascii=False))
    print(f"\nFull results saved to: {output_path}")


if __name__ == "__main__":
    main()
