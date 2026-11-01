#!/usr/bin/env python3
"""Extract the answered originals, inline glosses and reference translations.

The source PDF repeats every paper: first as a blank exercise and then with
answers.  This script deliberately takes the second copy only.  It writes an
auditable intermediate JSON file; the runtime importer never parses a PDF.
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

PDF = Path(sys.argv[1])
OUT = Path(sys.argv[2])

GROUPS = [
    ("嘉定", 1, 3, "孙承宗传（节选）", "", "明"),
    ("奉贤", 4, 6, "刘晏传（节选）", "", "唐"),
    ("宝山", 7, 9, "贺双卿", "史震林", "清"),
    ("崇明", 10, 13, "蒙氏兄弟与赵高（材料一、二）", "王夫之", "清"),
    ("徐汇", 14, 16, "钱公辅传", "", "宋"),
    ("普陀", 17, 19, "濂溪先生事实记（节选）", "朱熹", "宋"),
    ("杨浦", 20, 22, "养浩毛先生传", "戴震", "清"),
    ("松江", 23, 25, "蒋岳麓先生家传", "梅曾亮", "清"),
    ("浦东", 26, 28, "胡居仁传（节选）", "", "明"),
    ("虹口", 29, 31, "文定公行实", "徐骥", "明"),
    ("金山", 32, 34, "傅咸传", "", "晋"),
    ("长宁", 35, 37, "宋弁传", "", "北魏"),
    ("闵行", 38, 40, "陆先生传（节选）", "归有光", "明"),
    ("青浦", 41, 43, "陆老圃传", "朱察卿", "明"),
    ("静安", 44, 47, "褚遂良传（材料一、二）", "刘昫、欧阳修", "唐、宋"),
    ("黄浦", 48, 52, "归有光文论四则", "归有光、王世贞、钱谦益、方苞", "明、清"),
]

HEADER = "上海高三一模传记文言实词梳理"
DOTS = "．"
PARA = set("①②③④⑤⑥⑦⑧⑨⑩")


def raw_pages(first: int, last: int) -> str:
    result = subprocess.run(
        ["pdftotext", "-f", str(first), "-l", str(last), "-raw", str(PDF), "-"],
        check=True, capture_output=True, text=True,
    )
    return result.stdout


def clean_lines(text: str) -> str:
    lines: list[str] = []
    for line in text.replace("\r", "").splitlines():
        value = line.strip()
        if not value or value == HEADER or value.isdigit():
            continue
        if re.fullmatch(r"（2026\s*一模·.+?区）", value):
            continue
        lines.append(value)
    return "".join(lines).replace(" ", "")


def balanced_paren(text: str, start: int) -> tuple[str, int]:
    assert text[start] in "（("
    opens, closes = "（(", "）)"
    depth = 0
    for i in range(start, len(text)):
        if text[i] in opens:
            depth += 1
        elif text[i] in closes:
            depth -= 1
            if depth == 0:
                return text[start + 1:i], i + 1
    raise ValueError(f"unclosed gloss near {text[start:start+80]}")


def source_cut(text: str) -> int:
    candidates = [p for marker in ("（选自", "(选自") if (p := text.find(marker)) >= 0]
    # A small [注] marker can occur inline after the referenced word.  The
    # actual note block is the final occurrence and follows most of the text.
    for marker in ("[注", "【注"):
        p = text.rfind(marker)
        if p > len(text) * .55:
            candidates.append(p)
    return min(candidates) if candidates else len(text)


def title_cut(text: str) -> str:
    # Originals begin at a numbered paragraph or an explicit material label.
    candidates = [p for marker in (*PARA, "材料一：", "材料一:") if (p := text.find(marker)) >= 0]
    return text[min(candidates):] if candidates else text


def add_paragraphs(text: str) -> tuple[str, list[int]]:
    inserts: list[int] = []
    for index, char in enumerate(text):
        if char in PARA and index > 0 and text[index - 1] in "。！？”』）":
            inserts.append(index)
    for match in re.finditer(r"材料[一二三四]：", text):
        if match.start() > 0 and text[match.start() - 1] in "。！？”』）":
            inserts.append(match.start())
    inserts = sorted(set(inserts))
    parts: list[str] = []
    cursor = 0
    for position in inserts:
        parts.extend((text[cursor:position], "\n")); cursor = position
    parts.append(text[cursor:])
    return "".join(parts).strip(), inserts


def extract_answer(text: str) -> tuple[str, list[dict]]:
    text = title_cut(clean_lines(text))
    # Multi-material papers repeat bibliographic citations between excerpts;
    # keep them in metadata rather than treating them as source sentences.
    text = re.sub(r"（节选自[^（）]+(?:《[^》]+》)[^（）]*）", "", text)
    text = text[:source_cut(text)]
    body: list[str] = []
    glosses: list[dict] = []
    i = 0
    while i < len(text):
        if text[i] != DOTS:
            body.append(text[i])
            i += 1
            continue
        j = i
        while j < len(text) and text[j] == DOTS:
            j += 1
        count = j - i
        if j >= len(text) or text[j] not in "（(":
            body.extend(text[i:j]); i = j; continue
        meaning, end = balanced_paren(text, j)
        current = "".join(body)
        word = current[-count:]
        if len(word) != count or any(ch in "，。！？；：、\n" for ch in word):
            raise ValueError(f"bad target before gloss: {current[-20:]} / {meaning}")
        glosses.append({"word": word, "meaning": meaning.strip(), "articleStart": len(current) - count})
        i = end
    compact = "".join(body)
    original, inserts = add_paragraphs(compact)
    # Paragraph newlines shift later offsets by one character each.
    for row in glosses:
        row["articleStart"] += sum(position <= row["articleStart"] for position in inserts)
        if original[row["articleStart"]:row["articleStart"] + len(row["word"])] != row["word"]:
            raise ValueError(f"lost target {row}")
    return original, glosses


def extract_translation(text: str) -> str:
    value = title_cut(clean_lines(text))
    return add_paragraphs(value)[0]


def sentences(text: str) -> list[tuple[int, str]]:
    result: list[tuple[int, str]] = []
    start = 0
    for match in re.finditer(r"[。！？](?:[”’』】])?", text):
        end = match.end()
        chunk = text[start:end]
        if chunk.strip():
            leading = len(chunk) - len(chunk.lstrip("\n"))
            result.append((start + leading, chunk.lstrip("\n")))
        start = end
    if text[start:].strip():
        leading = len(text[start:]) - len(text[start:].lstrip("\n"))
        result.append((start + leading, text[start:].lstrip("\n")))
    return result


def paragraph_key(value: str) -> str:
    match = re.match(r"(材料[一二三四]：|[①②③④⑤⑥⑦⑧⑨⑩])", value)
    return match.group(1) if match else ""


def align_flat(original: str, translated: str) -> list[dict]:
    src = sentences(original)
    dst = sentences(translated)
    # Sequence alignment permits adjoining reference sentences to be joined,
    # and a single translated sentence to be split between two short originals.
    n, m = len(src), len(dst)
    inf = 1e9
    dp = [[inf] * (m + 1) for _ in range(n + 1)]
    prev: list[list[tuple[int, int, str, int, int] | None]] = [[None] * (m + 1) for _ in range(n + 1)]
    dp[0][0] = 0
    for i in range(n):
        for j in range(m):
            if dp[i][j] >= inf:
                continue
            for take in (1, 2, 3):
                if j + take > m:
                    continue
                s = src[i][1]
                t = "".join(x[1] for x in dst[j:j + take])
                ratio = abs(len(t) / max(1, len(s)) - 1.65)
                marker_penalty = 100 if paragraph_key(s) != paragraph_key(t) else 0
                join_penalty = (take - 1) * .7
                score = dp[i][j] + ratio + marker_penalty + join_penalty
                if score < dp[i + 1][j + take]:
                    dp[i + 1][j + take] = score
                    prev[i + 1][j + take] = (i, j, "join", take, 0)
            if i + 1 < n:
                first, second = src[i][1], src[i + 1][1]
                target = dst[j][1]
                cuts = [match.end() for match in re.finditer(r"[，；：]", target) if 3 <= match.end() <= len(target) - 3]
                if cuts:
                    ideal = len(target) * len(first) / (len(first) + len(second))
                    cut = min(cuts, key=lambda value: abs(value - ideal))
                    ratio = abs(len(target) / max(1, len(first) + len(second)) - 1.65)
                    marker_penalty = 100 if paragraph_key(first) != paragraph_key(target) else 0
                    score = dp[i][j] + ratio + marker_penalty + .7
                    if score < dp[i + 2][j + 1]:
                        dp[i + 2][j + 1] = score
                        prev[i + 2][j + 1] = (i, j, "split", 1, cut)
    if prev[n][m] is None:
        raise ValueError(f"cannot align {n} source sentences with {m} translation sentences")
    operations: list[tuple[int, int, str, int, int]] = []
    i, j = n, m
    while i:
        item = prev[i][j]
        if item is None:
            raise ValueError("broken alignment")
        operations.append(item); i, j = item[0], item[1]
    operations.reverse()
    result: list[dict] = []
    for source_index, target_index, kind, take, cut in operations:
        if kind == "join":
            start, source = src[source_index]
            result.append({"articleStart": start, "source": source,
                           "translation": "".join(x[1] for x in dst[target_index:target_index + take]).strip()})
        else:
            target = dst[target_index][1]
            for offset, translation in enumerate((target[:cut], target[cut:])):
                start, source = src[source_index + offset]
                result.append({"articleStart": start, "source": source, "translation": translation.strip()})
    for index, row in enumerate(result, 1):
        row["id"] = f"sentence-{index}"
    return result


def align(original: str, translated: str) -> list[dict]:
    source_paragraphs = original.splitlines()
    translated_paragraphs = translated.splitlines()
    source_keys = [paragraph_key(value) for value in source_paragraphs]
    translated_keys = [paragraph_key(value) for value in translated_paragraphs]
    if len(source_paragraphs) > 1 and source_keys == translated_keys:
        result: list[dict] = []
        source_cursor = 0
        for source, target in zip(source_paragraphs, translated_paragraphs):
            start = original.find(source, source_cursor)
            for row in align_flat(source, target):
                row["articleStart"] += start
                result.append(row)
            source_cursor = start + len(source)
        for index, row in enumerate(result, 1):
            row["id"] = f"sentence-{index}"
        return result
    return align_flat(original, translated)


def main() -> None:
    articles: list[dict] = []
    all_glosses = 0
    for district, first, last, title, author, era in GROUPS:
        text = raw_pages(first, last)
        marker = re.compile(rf"（2026\s*一模·{district}区）")
        hits = list(marker.finditer(text))
        if len(hits) < 2:
            raise ValueError(f"{district}: expected duplicate exercise")
        reference = text.find("【参考译文】", hits[1].end())
        if reference < 0:
            raise ValueError(f"{district}: missing translation")
        original, glosses = extract_answer(text[hits[1].end():reference])
        translation = extract_translation(text[reference + len("【参考译文】"):])
        aligned = align(original, translation)
        key = hashlib.sha256(district.encode()).hexdigest()[:12]
        source_sentences = sentences(original)
        for index, row in enumerate(glosses, 1):
            row["ref"] = f"{district}-{index:03d}"
            sentence_start, sentence = next((s for s in source_sentences if s[0] <= row["articleStart"] < s[0] + len(s[1])), (0, original))
            row["context"] = sentence
            row["contextStart"] = row["articleStart"] - sentence_start
        all_glosses += len(glosses)
        articles.append({
            "id": f"biography2026:article:{key}", "district": district, "title": title,
            "author": author, "era": era, "body": original,
            "summary": f"2026 上海高三一模·{district}区传记文言材料",
            "translations": aligned, "glosses": glosses,
        })
        print(f"{district}: {len(original)} chars, {len(glosses)} glosses, {len(aligned)} sentences", file=sys.stderr)
    payload = {
        "id": "biography-2026-v1", "title": "2026高三一模传记文言实词梳理-总",
        "sourceSha256": hashlib.sha256(PDF.read_bytes()).hexdigest(),
        "stats": {"articles": len(articles), "glosses": all_glosses,
                  "translations": sum(len(a["translations"]) for a in articles)},
        "articles": articles,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
