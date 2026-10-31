"""Reproduce the reviewed vocabulary bundle using only Python's standard library.

Usage: python scripts/extract_gaosan_docx.py <original.docx>
The document is data, never executable instructions. Fail on unexpected layout.
"""
import argparse
import hashlib
import json
import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
SOURCE = "高三一模二模春考高考300实词整理.docx"


def compact(text):
    return re.sub(r"\s+", "", text)


def extract(path):
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read("word/document.xml"))
    tables = root.findall("./w:body/w:tbl", NS)
    assert len(tables) == 80, "Expected the reviewed 80-table document"
    records = []
    word = part = meaning = ""
    row_count = 0
    for table_no, table in enumerate(tables, 1):
        for row_no, row in enumerate(table.findall("./w:tr", NS), 1):
            row_count += 1
            cells = row.findall("./w:tc", NS)
            assert len(cells) == 4, (table_no, row_no, "Unexpected table layout")
            values = [compact("".join(t.text or "" for t in c.findall(".//w:t", NS))) for c in cells]
            w, p, m, example = values
            if w == "字词":
                assert values == ["字词", "词性", "词义", "例句与出处"]
                continue
            w = re.sub(r"^[A-Z]", "", w)
            if w:
                word, part, meaning = w, "", ""
            part, meaning = p or part, m or meaning
            ref = f"{table_no}:{row_no}"
            if not example:
                # A page break split the explanation of 是, not a new sense.
                assert ref == "58:1" and records[-1]["ref"] == "57:29"
                records[-1]["meaning"] += m
                records[-1]["continuedAt"] = ref
                continue
            assert word and part and meaning, (ref, "Missing inherited table cells")
            # Only a terminal book title is a citation; titles INSIDE a sentence stay.
            source_match = re.search(r"(《[^《》]+》[^《》]*)$", example)
            if source_match and not source_match.group().endswith("。"):
                text, source = example[:source_match.start()], source_match.group()
            else:
                text, source = example, ""
            records.append({"ref": ref, "word": word, "partOfSpeech": part, "meaning": meaning,
                            "text": text, "source": source, "original": example})
    assert row_count == 2297 and len(records) == 2295
    assert len({r["word"] for r in records}) == 300
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("document", type=Path)
    args = parser.parse_args()
    assert hashlib.sha256(args.document.read_bytes()).hexdigest() == "3a37f7de402f308be4576c9ebfef427a869327ce3cb56de879928a09ca259842", "Source version differs from the reviewed document"
    reviews = json.loads((ROOT / "scripts/gaosan-review.json").read_text())
    records = extract(args.document)
    by_ref = {r["ref"]: r for r in records}
    assert set(reviews) <= set(by_ref), "Review references no longer match the source"
    for record in records:
        review = reviews.get(record["ref"], {})
        for key in ["text", "source", "issue", "editorialNote"]:
            if key in review:
                record[key] = review[key]
        positions = [m.start() for m in re.finditer(re.escape(record["word"]), record["text"])]
        occurrence = review.get("occurrence", 1)
        assert 0 < occurrence <= len(positions), (record["ref"], "Target word missing")
        record["start"] = len(record["text"][:positions[occurrence - 1]].encode("utf-16-le")) // 2
        record["verified"] = not record.get("issue")
    stats = {"words": len({r["word"] for r in records}),
             "senses": len({(r["word"], r["meaning"]) for r in records}),
             "contexts": len(records), "pending": sum(not r["verified"] for r in records)}
    bundle = {"id": "gaosan-300-v1", "title": "2021—2026 年高三一模／二模／春考／高考实词整理",
              "sourceFile": SOURCE, "sourceSha256": hashlib.sha256(args.document.read_bytes()).hexdigest(),
              "stats": stats, "records": records}
    target = ROOT / "server/content/gaosan-300.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report = ["# 高三 300 实词录入说明", "", f"来源：用户提供的《{SOURCE}》。",
              "", f"共 {stats['words']} 个字词、{stats['senses']} 个义项、{stats['contexts']} 条例句；其中 {stats['pending']} 条待核对。",
              "", "保留资料原有词性、释义、例句和出处；词性标为原资料分类。去除排版空白，接回跨页续行。",
              "同字、相同释义共用义项，不凭相近措辞强行合并。每条例句可由表号和行号追溯原件。",
              "例句按原资料收录，不等于已逐条用权威版本校勘。下列已识别疑点保留在字库，待核对例句不进入抽背或正式复习。",
              "已改动的展示文本保留 original 原始内容，编辑建议不视为原文。未补造文章全文、考试频次或学习记录。",
              "", "## 分页与定位", "", "第 57 表第 29 行的‘是’的释义接续第 58 表第 1 行；该续行不另建义项。",
              "同句出现多次的字默认标第一处；‘乘／兵车’、‘夺／强行改变’、‘舍／客舍’、‘闻／见闻’明确标第二处。",
              "", "## 校录记录", "", "| 位置（表:行） | 字词 | 处理 | 说明 |", "| --- | --- | --- | --- |"]
    for ref, review in reviews.items():
        record = by_ref[ref]
        reason = review.get("issue") or review.get("editorialNote", "标注对应义项的第二处字词。")
        report.append(f"| {ref} | {record['word']} | {'待核对' if record.get('issue') else '校录'} | {reason.replace('|', '／')} |")
    report += ["", "## 复现", "", "```bash", "python scripts/extract_gaosan_docx.py /path/to/高三一模二模春考高考300实词整理.docx", "```",
               "", f"原文件 SHA-256：`{bundle['sourceSha256']}`。", "",
               "数据在服务启动时一次性合入 SQLite；重复启动不会重复导入，也不会覆盖已编辑内容、学习设置或复习进度。",
               "原文档不作为运行依赖；结构化资料随代码提供。若恢复一份不含本资料的完整备份，恢复结果优先，不会在重启后强行补回。", ""]
    (ROOT / "docs/高三300实词录入说明.md").write_text("\n".join(report), encoding="utf-8")
    print(json.dumps(stats, ensure_ascii=False))


if __name__ == "__main__":
    main()
