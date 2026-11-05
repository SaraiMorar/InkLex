#!/usr/bin/env python3
"""Extract only the reviewed understanding-recall questions from Topic 01.

The 32 continuation/literary-knowledge questions and all other chapters are
excluded. The original DOCX remains in the Git-ignored local-sources directory.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
SOURCE_NAME = '专题01 积累运用（解析版）.docx'
SOURCE = ROOT / 'resources/local-sources' / SOURCE_NAME
OUT = ROOT / 'server/content/recitation-topic01.json'
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
# Every item was reviewed by meaning, rather than treating all fill-ins as recall.
SELECTED = [
    (12, '蜀道难', '李白'), (19, '陈情表', '李密'),
    (26, '蜀相', '杜甫'), (33, '登高', '杜甫'),
    (40, '劝学', '荀子'), (47, '〈老子〉四章', '老子'),
    (54, '屈原列传', '司马迁'), (61, '〈论语〉十二章', '孔子及弟子'),
    (68, '〈老子〉四章', '老子'), (75, '兰亭集序', '王羲之'),
    (82, '〈论语〉十二章', '孔子及弟子'), (89, '登高', '杜甫'),
    (96, '〈论语〉十二章', '孔子及弟子'), (103, '蜀道难', '李白'),
    (110, '短歌行', '曹操'), (117, '〈老子〉四章', '老子'),
]


def main():
    with ZipFile(SOURCE) as archive:
        body = ET.fromstring(archive.read('word/document.xml')).find(W + 'body')
    rows = [''.join(t.text or '' for t in p.iter(W + 't')) for p in body.iter(W + 'p')]
    assert rows[6] == '考点01 默写' and rows[123] == '考点02语意连贯'
    numbered = [i for i in range(9, 123) if re.match(r'^（[123]）', rows[i])]
    selected_indices = {index for index, _, _ in SELECTED}
    assert len(numbered) == 48
    assert {i for i in numbered if rows[i].startswith('（3）')} == selected_indices
    excluded = [i for i in numbered if i not in selected_indices]
    assert len(excluded) == 32

    questions, provenance = [], []
    for number, (index, work, author) in enumerate(SELECTED, 1):
        header = re.fullmatch(r'（([一二三四五六七八九十]+)）（(2025·上海.+·二模)）.*', rows[index - 3])
        assert header, (index, rows[index - 3])
        assert rows[index - 2].startswith('（1）') and rows[index - 1].startswith('（2）')
        assert rows[index].startswith('（3）') and rows[index + 1].startswith('【答案】')
        # Each group has five ordered answers: three for (1)/(2), two for (3).
        answers = re.split(r'\s{2,}', rows[index + 1].removeprefix('【答案】').strip())
        assert len(answers) == 5 and all(answers), (index, answers)
        prompt = re.sub(r'\s{2,}', '＿＿＿＿', rows[index][3:]).strip()
        assert prompt.count('＿＿＿＿') == 2
        questions.append({
            'id': f'recitation:topic01:{number:03}', 'work': work, 'author': author,
            'number': number, 'prompt': prompt, 'answers': answers[-2:],
            'alternatives': [[], []],
            'note': f'出处：{header[2]}，第（{header[1]}）组第（3）题。',
            'source': SOURCE_NAME, 'articleId': None,
        })
        provenance.append({'id': questions[-1]['id'], 'paragraph': index, 'answerParagraph': index + 1,
                           'group': header[1], 'exam': header[2], 'subquestion': 3})
    result = {
        'id': 'understanding-recitations-topic01-20261106-v1',
        'source': {'file': SOURCE_NAME, 'sha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest()},
        'selection': {'rule': '根据含义、典故、情境或表达作用回忆原句；不录入上下句填空和文学常识。',
                      'selected': provenance, 'excludedContinuationParagraphs': excluded},
        'stats': {'questions': len(questions), 'answers': sum(len(q['answers']) for q in questions),
                  'works': len({q['work'] for q in questions})},
        'questions': questions,
    }
    assert result['stats'] == {'questions': 16, 'answers': 32, 'works': 10}
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(result['stats'], 'excluded continuation questions:', len(excluded))


if __name__ == '__main__':
    main()
