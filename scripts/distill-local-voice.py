#!/usr/bin/env python3
"""Distill completed line-cited chunk analyses into one auditable voice profile."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ANALYSIS_VERSION = "voice-chunk-v6"
PROFILE_VERSION = "voice-profile-v6"
KINDS = ("voice_move", "reasoning", "dialogue", "phrasing", "boundary")


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--max-tokens", type=int, default=2_800)
    return parser.parse_args()


def evenly_sample(items: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    if len(items) <= limit:
        return items
    if limit == 1:
        return [items[len(items) // 2]]
    return [items[round(index * (len(items) - 1) / (limit - 1))] for index in range(limit)]


def load_material(db: sqlite3.Connection) -> dict[str, Any]:
    status = dict(db.execute(
        "SELECT status, COUNT(*) FROM semantic_jobs WHERE schema_version=? GROUP BY status",
        (ANALYSIS_VERSION,),
    ).fetchall())
    total_jobs = db.execute(
        "SELECT COUNT(*) FROM semantic_jobs WHERE schema_version=?", (ANALYSIS_VERSION,)
    ).fetchone()[0]
    covered_lines = db.execute(
        "SELECT COALESCE(SUM(line_count), 0) FROM semantic_jobs WHERE schema_version=?",
        (ANALYSIS_VERSION,),
    ).fetchone()[0]
    if status.get("complete", 0) != total_jobs or covered_lines != 582_135 or any(status.get(key, 0) for key in ("pending", "running", "failed")):
        raise RuntimeError(f"Refusing partial distillation; semantic jobs are {status}")

    rows = db.execute(
        """
        SELECT j.source_key, j.start_line, j.end_line, a.analysis_json
        FROM semantic_jobs j JOIN semantic_analyses a USING (job_key)
        WHERE j.schema_version=? ORDER BY j.source_key, j.start_line
        """,
        (ANALYSIS_VERSION,),
    ).fetchall()
    topics: Counter[str] = Counter()
    by_source_kind: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for source_key, start_line, end_line, raw in rows:
        analysis = json.loads(raw)
        topics.update(str(topic).strip() for topic in analysis.get("topics", []) if str(topic).strip())
        for observation in analysis.get("observations", []):
            kind = observation.get("kind")
            if kind not in KINDS:
                continue
            evidence = [int(line) for line in observation.get("evidence_lines", []) if start_line <= int(line) <= end_line]
            if not evidence:
                continue
            excerpts: list[str] = []
            for line in evidence[:3]:
                window = db.execute(
                    """
                    SELECT line_number, line_text FROM lines
                    WHERE source_key=? AND line_number BETWEEN ? AND ? ORDER BY line_number
                    """,
                    (source_key, max(1, line - 2), line + 2),
                ).fetchall()
                excerpts.append(" / ".join(f"L{number}:{text}" for number, text in window if text.strip()))
            by_source_kind[(source_key, kind)].append({
                "source_key": source_key,
                "summary": str(observation.get("summary", "")).strip(),
                "evidence_lines": evidence[:3],
                "evidence_excerpt": " || ".join(excerpts)[:320],
            })

    samples: list[dict[str, Any]] = []
    for source_kind in sorted(by_source_kind):
        samples.extend(evenly_sample(by_source_kind[source_kind], 8))

    markers = db.execute(
        """
        SELECT marker, SUM(occurrence_count) AS total
        FROM voice_marker_counts GROUP BY marker ORDER BY total DESC
        """
    ).fetchall()
    signals = db.execute(
        """
        SELECT signal, SUM(line_count) AS total
        FROM speech_signal_counts GROUP BY signal ORDER BY total DESC
        """
    ).fetchall()
    return {
        "coverage": {"jobs": len(rows), "lines": covered_lines},
        "top_topics": topics.most_common(30),
        "marker_counts": markers,
        "speech_signal_counts": signals,
        "distributed_observations": samples,
    }


def prompt(material: dict[str, Any]) -> str:
    return f"""你是严谨的中文语料研究员。下面的数据来自两份授权语料的逐行分析：共 {material['coverage']['lines']} 行、{material['coverage']['jobs']} 个连续区块。每条观察都附带原始来源和行号。

请建立“曲曲”的可执行对话人格模型，而不是泛化情感咨询模板。只根据数据归纳；频率不等于价值判断；课程讲解、直播问答、案例复述要区分。每条候选观察都带证据窗口，若 summary 与窗口不符必须丢弃。禁止模仿长段原文。

只输出合法 JSON，不要 Markdown、不要思考过程。结构：
{{
  "version":"{PROFILE_VERSION}",
  "core_worldview":[{{"principle":"底层判断", "evidence":[{{"source_key":"...","line":1}}]}}],
  "reasoning_sequence":[{{"step":1,"move":"推理动作","description":"如何做", "evidence":[{{"source_key":"...","line":1}}]}}],
  "dialogue_moves":[{{"trigger":"用户状态或说法","move":"如何承接、判断、追问","evidence":[{{"source_key":"...","line":1}}]}}],
  "language_rhythm":[{{"pattern":"节奏或句式规律","function":"作用","evidence":[{{"source_key":"...","line":1}}]}}],
  "scenario_patterns":[{{"scenario":"常见问题","diagnosis":"核心矛盾","action":"动作","validation":"验证标准","evidence":[{{"source_key":"...","line":1}}]}}],
  "boundaries":[{{"rule":"明确边界","evidence":[{{"source_key":"...","line":1}}]}}],
  "anti_imitation":["为了避免机械假模仿而不能做的事"]
}}

要求：每个对象至少 1 条证据；证据只能复制输入中真实存在的 source_key 和 line。core_worldview 4–8 项，reasoning_sequence 4–8 项，dialogue_moves 6–12 项，language_rhythm 5–10 项，scenario_patterns 6–12 项，boundaries 4–8 项，anti_imitation 4–8 项。描述要具体、可执行、能指导多轮对话。

<analysis_data>
{json.dumps(material, ensure_ascii=False, separators=(",", ":"))}
</analysis_data>"""


def parse_output(raw: str) -> dict[str, Any]:
    text = re.sub(r"^<think>.*?</think>\s*", "", raw.strip(), flags=re.DOTALL)
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError("Profile output is not JSON")
    value = json.loads(match.group(0))
    if value.get("version") != PROFILE_VERSION:
        raise ValueError("Profile version mismatch")
    return value


def validate_profile(db: sqlite3.Connection, profile: dict[str, Any]) -> None:
    fields = ("core_worldview", "reasoning_sequence", "dialogue_moves", "language_rhythm", "scenario_patterns", "boundaries", "anti_imitation")
    if any(not isinstance(profile.get(field), list) or not profile[field] for field in fields):
        raise ValueError("Profile is missing a required non-empty list")
    for field in fields[:-1]:
        for item in profile[field]:
            evidence = item.get("evidence") if isinstance(item, dict) else None
            if not isinstance(evidence, list) or not evidence:
                raise ValueError(f"Profile item in {field} has no evidence")
            for citation in evidence:
                source_key = citation.get("source_key")
                line = citation.get("line")
                exists = db.execute(
                    "SELECT 1 FROM lines WHERE source_key=? AND line_number=?",
                    (source_key, line),
                ).fetchone()
                if not exists:
                    raise ValueError(f"Invalid evidence citation: {source_key}:{line}")


def main() -> None:
    config = arguments()
    db = sqlite3.connect(str(Path(config.db).expanduser().resolve()), timeout=60)
    material = load_material(db)

    from mlx_lm import generate, load
    from mlx_lm.sample_utils import make_sampler

    model_path = str(Path(config.model).expanduser().resolve())
    model, tokenizer = load(model_path)
    messages = [{"role": "user", "content": prompt(material)}]
    try:
        formatted = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
    except TypeError:
        formatted = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    raw = generate(model, tokenizer, prompt=formatted, max_tokens=config.max_tokens, sampler=make_sampler(temp=0.0), verbose=False)
    profile = parse_output(raw)
    validate_profile(db, profile)
    canonical = json.dumps(profile, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS voice_profiles (
          profile_version TEXT PRIMARY KEY,
          analysis_version TEXT NOT NULL,
          model TEXT NOT NULL,
          profile_json TEXT NOT NULL,
          profile_hash TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
        """
    )
    db.execute(
        "INSERT OR REPLACE INTO voice_profiles VALUES (?, ?, ?, ?, ?, ?)",
        (
            PROFILE_VERSION,
            ANALYSIS_VERSION,
            Path(model_path).parent.parent.parent.name,
            canonical,
            hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
            datetime.now(timezone.utc).isoformat(),
        ),
    )
    db.commit()
    list_fields = ("core_worldview", "reasoning_sequence", "dialogue_moves", "language_rhythm", "scenario_patterns", "boundaries", "anti_imitation")
    print(json.dumps({"profileVersion": PROFILE_VERSION, "profileHash": hashlib.sha256(canonical.encode("utf-8")).hexdigest(), "items": {key: len(profile[key]) for key in list_fields}}, ensure_ascii=False))


if __name__ == "__main__":
    main()
