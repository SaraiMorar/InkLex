#!/usr/bin/env python3
"""Extract the reviewed reading passages from the three supplied answer DOCX files.

Only the paragraph ranges below are reading texts. Exercise prompts, answers to
unrelated questions and inline literary analysis are never treated as originals.
Run from any directory; sources and output are relative to the repository root.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / "resources/local-sources"
OUT = ROOT / "server/content/exam-articles.json"
REVIEW = ROOT / "scripts/exam-articles-review.json"
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
JINGAN = "综合练习四（静安）答案订正.docx"
JINSHAN = "综合练习七（2026金山2模）答案详解.docx"
WEEKLY = "10月30日高三语文周测答案.docx"

# Each word is anchored immediately before a parenthesized source explanation.
# Numeric parentheses are question commentary, not word glosses.
WORDS = {
    161: ["孤介", "平居", "日", "非", "廷对", "助", "奉", "躬", "樵", "股", "素服", "易"],
    163: ["遗", "交", "当道", "币", "负", "薪", "若", "诘", "故", "虚", "面", "失", "向", "物色", "卒", "公车", "辄", "行", "郭", "且"],
    165: ["值", "邑", "方", "兴", "签", "任", "赀", "阅", "趋", "谢罪", "若", "密", "或", "稀", "与", "虚"],
    167: ["致", "下榻", "迎", "得", "受业"],
    202: ["名", "谒", "岂", "襟带", "烟霏", "灭"],
    204: ["尝", "蓑", "啸歌", "玲珑", "窈窕"],
    205: ["宁"], 206: ["陂"], 207: ["提携"], 209: ["何以"],
    215: ["霁", "少焉", "但", "倏尔", "逝", "荇"],
    217: ["逸", "发", "飘萧", "兴", "故", "泛", "度", "歇", "恙", "几研", "履", "屐"],
    219: ["姑"],
}
REPAIRS = {
    165: [("阅数日大学士杜立德闻孔昭在邑急往候之吏闻趋谢罪。",
           "阅数日，大学士杜立德闻孔昭在邑，急往候之。吏闻，趋谢罪。")],
    217: [("履屐之下与”", "履屐之下与？”")],
    26: [("乔叹曰：国势如此，而杀忠臣，吾不知所税驾也，然不能白其诬，仁肇卒，逾年，后主遂见讨，又逾年，国为墟矣。",
          "乔叹曰：“国势如此，而杀忠臣，吾不知所税驾也。”然不能白其诬。仁肇卒，逾年，后主遂见讨；又逾年，国为墟矣。")],
}


def paragraphs(path: Path) -> dict[int, str]:
    with ZipFile(path) as archive:
        doc = ET.fromstring(archive.read("word/document.xml"))
    result = {}
    for index, p in enumerate(doc.find(f"{W}body").iter(f"{W}p")):
        result[index] = "".join(
            node.text or "" if node.tag == f"{W}t" else "\n" if node.tag == f"{W}br" else "\t"
            for node in p.iter() if node.tag in (f"{W}t", f"{W}br", f"{W}tab")
        ).strip()
    return result


def clean(text: str) -> str:
    return re.sub(r"[ \t\u00a0]", "", text).strip()


def utf16(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def sentences(text: str) -> list[str]:
    # Same sentence boundaries as src/domain/model.ts articleSentences.
    result, start = [], 0
    for match in re.finditer(r"[。！？](?:[”’』】])?", text):
        result.append(text[start:match.end()]); start = match.end()
    if text[start:]:
        result.append(text[start:])
    return result


def extract_original(raw: str, index: int, annotated: bool) -> tuple[str, list[dict]]:
    text = clean(re.sub(r"^（\d+）|^[①②③④⑤⑥⑦⑧⑨⑩]", "", raw))
    glosses = []
    if annotated:
        text = re.sub(r"[①②③④⑤⑥⑦⑧⑨⑩]", "", text)
        target_words = iter(WORDS.get(index, []))
        parts, cursor = [], 0
        for match in re.finditer(r"[（(]([^（）()]*)[）)]", text):
            parts.append(text[cursor:match.start()])
            meaning = match.group(1)
            if not re.match(r"\d", meaning):
                word = next(target_words)
                prefix = "".join(parts)
                assert prefix.endswith(word), (index, word, prefix)
                glosses.append({"ref": f"jinshan:{index}:{len(glosses) + 1}", "word": word,
                                "meaning": meaning, "prefix": prefix[:-len(word)],
                                "issue": ""})
            cursor = match.end()
        parts.append(text[cursor:])
        text = "".join(parts)
        assert next(target_words, None) is None, index
    for old, new in REPAIRS.get(index, []):
        assert old in text, (index, old)
        # Only punctuation is restored, using the supplied answer and translation.
        assert re.sub(r"\W", "", old) == re.sub(r"\W", "", new)
        text = text.replace(old, new)
    letter_positions = [i for i, char in enumerate(text) if re.match(r"\w", char)]
    for row in glosses:
        # Map by the exact original character sequence, including when a comma
        # was inserted immediately before the annotated word in the answer.
        position = letter_positions[len(re.sub(r"\W", "", row.pop("prefix")))]
        assert text[position:position + len(row["word"])] == row["word"], row
        row["articleStart"] = utf16(text[:position])
    return text, glosses


def make_article(spec: dict, docs: dict, review: dict) -> dict:
    blocks, glosses, translations, audit = [], [], [], []
    article_id = f"exam2026:article:{spec['key']}"
    offset = 0
    for block in spec["blocks"]:
        index, translation_indices = block[0], block[1:]
        original, definitions = extract_original(docs[spec["file"]][index], index, spec["file"] == JINSHAN)
        translation = "".join(clean(re.sub(r"^（\d+）", "", docs[spec["file"]][i])) for i in translation_indices)
        if spec["key"] == "yilvtang" and index in (207, 208):
            # The supplied translation combines the question and reply in p213.
            translation = sentences(translation)[0 if index == 207 else 1]
        counts = review[spec["key"]][str(index)]
        source_sentences, translated_sentences = sentences(original), sentences(translation)
        assert len(counts) == len(source_sentences), (spec["key"], index, source_sentences, counts)
        assert sum(counts) == len(translated_sentences), (spec["key"], index, translated_sentences, counts)
        t_cursor = 0
        for source, count in zip(source_sentences, counts):
            translated = "".join(translated_sentences[t_cursor:t_cursor + count]); t_cursor += count
            assert translated
            translations.append({"id": f"{article_id}:translation:{len(translations) + 1}",
                                 "articleStart": offset, "source": source, "translation": translated})
            offset += utf16(source)
        for definition in definitions:
            definition["articleStart"] += utf16("\n".join(blocks) + ("\n" if blocks else ""))
            glosses.append(definition)
        blocks.append(original)
        offset += 1  # the paragraph separator
        audit.append({"originalParagraph": index, "translationParagraphs": translation_indices,
                      "originalSource": docs[spec["file"]][index], "translationSource": translation})
    body = "\n".join(blocks)
    if spec["key"] == "li-kongzhao":
        word = "事"
        position = body.index("事之如所生")
        glosses.append({"ref": "jinshan:173:2", "word": word, "meaning": "侍奉",
                        "articleStart": utf16(body[:position]), "issue": ""})
    return {"id": article_id, "title": spec["title"], "author": spec["author"], "era": spec["era"],
            "body": body, "summary": spec["summary"], "sample": False, "collection": "extracurricular",
            "translations": translations, "glosses": glosses, "sourceFile": spec["file"], "audit": audit}


SPECS = [
    {"key": "duanzhou", "file": JINSHAN, "title": "书端州郡斋壁", "author": "包拯", "era": "宋",
     "summary": "2026金山二模 · 综合练习七；附原资料四联译文。原注：端州，今广东肇庆，包拯曾任端州知州。",
     "blocks": [[138, 139], [140, 141], [142, 143], [144, 145]]},
    {"key": "li-kongzhao", "file": JINSHAN, "title": "李孔昭传（节选）", "author": "", "era": "清",
     "summary": "2026金山二模 · 综合练习七；节选自《清史稿》，附原资料译文与字词释义，字词按原文标注保留。原注：埒（liè），等同，相等。",
     "blocks": [[161, 162], [163, 164], [165, 166], [167, 168]]},
    {"key": "yilvtang", "file": JINSHAN, "title": "依绿堂记", "author": "方岳", "era": "宋",
     "summary": "2026金山二模 · 综合练习七；附原资料译文与字词释义，字词按原文标注保留。原注：子方，作者自称；惠崇、郭熙，北宋画家，惠崇擅山水花鸟小景，郭熙精山水，文中借指名家山水景致；子猷访戴，出自《世说新语》，王子猷雪夜乘兴访友，兴尽而返，重在精神意趣相通。",
     "blocks": [[202, 203], [204, 210], [205, 211], [206, 212], [207, 213], [208, 213], [209, 214], [215, 216], [217, 218], [219, 220]]},
    {"key": "lin-renzhao", "file": WEEKLY, "title": "林仁肇传（节选）", "author": "", "era": "",
     "summary": "10月30日高三语文周测；据首句拟题，原文件未署篇名、作者和出处。附原资料全文译文。原文“国家衅其利”等字句按来稿保留，待核对。",
     "blocks": [[18, 19], [20, 21], [22, 23], [24, 25], [26, 27]]},
    {"key": "yizhangyuan", "file": WEEKLY, "title": "一掌园记", "author": "刘大櫆", "era": "清",
     "summary": "10月30日高三语文周测；附原资料全文译文。原文及异体字按来稿保留。",
     "blocks": [[30, 31], [32, 33]]},
    {"key": "qiushengfu", "file": WEEKLY, "title": "秋声赋", "author": "欧阳修", "era": "宋",
     "summary": "10月30日高三语文周测；附原资料全文译文。",
     "blocks": [[36, 37], [38, 39], [40, 41], [42, 43]]},
]


def main():
    docs = {name: paragraphs(SOURCES / name) for name in (JINGAN, JINSHAN, WEEKLY)}
    review = json.loads(REVIEW.read_text())
    articles = [make_article(spec, docs, review) for spec in SPECS]
    for article, spec in zip(articles, SPECS):
        # Every character of every supplied primary translation appears once.
        indices = dict.fromkeys(i for block in spec["blocks"] for i in block[1:])
        supplied = "".join(clean(re.sub(r"^（\d+）", "", docs[spec["file"]][i])) for i in indices)
        assert "".join(row["translation"] for row in article["translations"]) == supplied
        assert "".join(row["source"] for row in article["translations"]) == article["body"].replace("\n", "")
    pending = sum(bool(row["issue"]) for a in articles for row in a["glosses"])
    pack = {"id": "exam-articles-2026-11-v1",
            "sources": [{"file": name, "sha256": hashlib.sha256((SOURCES / name).read_bytes()).hexdigest()} for name in docs],
            "stats": {"articles": len(articles), "translations": sum(len(a["translations"]) for a in articles),
                      "glosses": sum(len(a["glosses"]) for a in articles), "pending": pending},
            "unresolved": [{"file": JINGAN, "reason": "只有答案订正、断句片段和分析，无完整课外文言文原文，不拼凑或补造篇目。",
                            "paragraphs": [{"index": i, "text": docs[JINGAN][i]} for i in (14, 15, 16, 17, 19, 22, 26, 27, 28, 29, 30)]}],
            "articles": articles}
    OUT.write_text(json.dumps(pack, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(pack["stats"], ensure_ascii=False))


if __name__ == "__main__":
    main()
