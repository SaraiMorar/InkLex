#!/usr/bin/env python3
"""Extract the answered 2025 second-mock originals and their supplied glosses.

Usage: python scripts/extract_biography_2025.py SOURCE.pdf OUTPUT.json
Raw uploads remain local. Notes and multi-material boundaries are retained.
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

from extract_biography_2026 import balanced_paren

PDF, OUT = Path(sys.argv[1]), Path(sys.argv[2])
GROUPS = [
    ('嘉定', 1, 4, '李陵降匈奴（材料一、二）', '司马光、王夫之', '宋、清'),
    ('奉贤', 5, 7, '王艮传（甲、乙）', '宋濂等、徐显', '明'),
    ('宝山', 8, 10, '竹轩先生传', '魏瀚', '明'),
    ('崇明', 11, 13, '史丹传（节选）', '班固', '汉'),
    ('徐汇', 14, 16, '李愬雪夜入蔡州（节选）', '司马光', '宋'),
    ('普陀', 17, 19, '韦丹传（节选）', '费枢', '宋'),
    ('杨浦', 20, 22, '二山人传', '方苞', '清'),
    ('松江', 23, 25, '冯婉贞传', '徐珂', '清'),
    ('浦东', 26, 28, '李长蘅墓志铭', '钱谦益', '清'),
    ('虹口', 29, 31, '李昉传（节选）', '脱脱等', '元'),
    ('金山', 32, 34, '张养浩传', '宋濂等', '明'),
    ('长宁', 35, 37, '李时传', '张廷玉等', '清'),
    ('闵行', 38, 40, '金涓传', '金江', '明'),
    ('青浦', 41, 43, '偃师知县卢君传', '刘大槐', '清'),
    ('静安', 44, 47, '严光与刘凝之（材料一、二）', '皇甫谧、沈约', '魏晋、南朝梁'),
    ('黄浦', 48, 50, '朱一桂传', '', '明'),
]
SOURCE_NOTE = re.compile(r'(?:\[注释\]|【注释】|\[注\]|【注】|注：)')
CITATION = re.compile(r'[（(](?:节选自|选自|《|\[魏晋\])[^（）()]*[）)]')
DOT = '．'


def clean(text):
    return ''.join(line.strip() for line in text.splitlines() if line.strip()
                   and not line.strip().isdigit() and '上海高三二模传记文言实词梳理' not in line
                   and '专注上海中高考' not in line).replace(' ', '').replace('\uf081', '①').replace('\uf082', '②')


def format_sections(text, district):
    if district == '静安':
        text = re.sub(r'^一(?=①)', '材料一：', text)
        text = text.replace('二①刘凝之', '材料二：①刘凝之')
    if district == '奉贤':
        text = re.sub(r'^甲(?=①)', '【甲】', text)
        text = text.replace('乙王公（王艮）', '【乙】王公（王艮）')
    text = re.sub(r'(材料[一二]：|【[甲乙]】)', r'\n\1', text)
    # Inline footnote numbers remain inside their sentences.
    return re.sub(r'(?<=[。！？….\u201d）])([①②③④⑤⑥⑦⑧⑨⑩])', r'\n\1', text).lstrip('\n')


def structure(text, district):
    text = format_sections(CITATION.sub('', text), district)
    starts = [m.start() for m in re.finditer(r'材料[一二]：|【[甲乙]】|①', text)]
    assert starts
    text = text[min(starts):]
    return text.strip()


def original(text, district):
    # Extract annotation notes before stripping the exercise's editorial glosses.
    note = SOURCE_NOTE.search(text)
    notes = text[note.start():] if note else ''
    text = text[:note.start()] if note else text
    if district == '松江':
        # Checked against the scanned page: the banner says 曰, not 日.
        text = text.replace('树帜日', '树帜曰')
    citations = CITATION.findall(text)
    # Normalize separated emphasis dots into the same target representation.
    text = re.sub(r'(?:[^\W\d_]．){2,}', lambda m: m[0].replace(DOT, '') + DOT * m[0].count(DOT), text)
    for old, new in [('见（同“现”，出现）', '见．（同“现”，出现）'),
                     ('屈（顺从）', '屈．（顺从）'), ('公车（官署，官府）', '公车．．（官署，官府）')]:
        text = text.replace(old, new)
    text = CITATION.sub('', text)
    output, glosses = [], []
    i = 0
    while i < len(text):
        if text[i] != DOT:
            output.append(text[i]); i += 1; continue
        j = i
        while j < len(text) and text[j] == DOT:
            j += 1
        if j >= len(text) or text[j] not in '（(':
            raise ValueError(f'{district}: detached emphasis near {text[max(0, i-12):j+30]}')
        meaning, end = balanced_paren(text, j)
        current = ''.join(output)
        word = current[-(j-i):]
        assert word and not re.search(r'[\s，。！？；：、/]', word), (district, word, meaning)
        glosses.append({'word': word, 'meaning': meaning.replace(DOT, ''), 'articleStart': len(current)-len(word)})
        i = end
    compact = ''.join(output)
    body = structure(compact, district)
    # Map offsets through inserted paragraph separators and removed title text.
    for row in glosses:
        marker = re.search(r'材料[一二]：|【[甲乙]】|①', compact)
        base = 0 if district == '静安' else marker.start()
        prefix = compact[base:row['articleStart']]
        prefix = format_sections(prefix, district)
        row['articleStart'] = len(prefix)
        assert body[row['articleStart']:row['articleStart']+len(row['word'])] == row['word'], (district, row)
    return body, glosses, notes, citations


def main():
    pages = subprocess.check_output(['pdftotext', '-raw', str(PDF), '-'], text=True).split('\f')
    articles = []
    for district, first, last, title, author, era in GROUPS:
        text = '\n'.join(pages[first-1:last])
        hits = list(re.finditer(rf'（2025\s*二模·{district}区）', text))
        assert len(hits) == 2
        answered, translated = re.split('【参考(?:译文|答案)】', text[hits[1].end():], maxsplit=1)
        body, glosses, notes, citations = original(clean(answered), district)
        translated = structure(clean(translated), district)
        # The reference often translates several sentences together. Preserve
        # its exact paragraph correspondence instead of guessing clause splits.
        sources, targets = body.splitlines(), translated.splitlines()
        key = lambda t: (re.match(r'(?:材料[一二]：|【[甲乙]】)?[①②③④⑤⑥⑦⑧⑨⑩]?', t) or [''])[0]
        assert len(sources) == len(targets) and list(map(key, sources)) == list(map(key, targets)), district
        translations = []
        cursor = 0
        for number, (source, translation) in enumerate(zip(sources, targets), 1):
            start = body.index(source, cursor); cursor = start + len(source)
            translations.append({'id': f'biography2025:translation:{district}-{number:03}',
                                 'articleStart': start, 'source': source, 'translation': translation})
        assert ''.join(r['translation'] for r in translations).replace('\n', '') == translated.replace('\n', '')
        for row in translations:
            assert body[row['articleStart']:row['articleStart']+len(row['source'])] == row['source']
        for number, row in enumerate(glosses, 1):
            row['ref'] = f'{district}-{number:03}'
        if notes:
            body += '\n\n' + notes
        assert not any(ord(c) > 0xFFFF for c in body), 'Add UTF-16 offset conversion for supplementary characters'
        key = hashlib.sha256(district.encode()).hexdigest()[:12]
        articles.append({'id': f'biography2025:article:{key}', 'district': district, 'title': title,
                         'author': author, 'era': era, 'body': body,
                         'summary': f'2025 上海高三二模·{district}区传记文言材料',
                         'sourcePages': [first, last], 'citations': citations, 'notes': notes,
                         'referenceTranslation': translated, 'glosses': glosses, 'translations': translations})
        print(district, len(body), 'characters,', len(glosses), 'glosses,', len(translations), 'translations')
    result = {'id': 'biography-2025-second-mock-20261106-v1', 'sourceFile': PDF.name,
              'sourceSha256': hashlib.sha256(PDF.read_bytes()).hexdigest(),
              'ocrCorrections': [{'page': 24, 'original': '树帜日', 'corrected': '树帜曰',
                                  'reason': '对照原页面确认的文字识别错误。'}],
              'stats': {'articles': len(articles), 'glosses': sum(len(a['glosses']) for a in articles),
                        'translations': sum(len(a['translations']) for a in articles)}, 'articles': articles}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
    print(result['stats'])


if __name__ == '__main__':
    main()
