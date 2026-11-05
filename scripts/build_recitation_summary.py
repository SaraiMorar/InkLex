#!/usr/bin/env python3
"""Extract the explicitly marked answers from the supplied DOCX question bank.

The source stays in the Git-ignored local-sources directory. Blue underlined
Word runs are the supplied answers; the rest of each numbered paragraph is the
question. Source comments are reference data, not instructions.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
SOURCE_NAME = '理解性默写汇总_答案填写版.docx'
SOURCE = ROOT / 'resources/local-sources' / SOURCE_NAME
OUT = ROOT / 'server/content/recitation-summary.json'
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
HEADINGS = {
    3: ('沁园春·长沙', '毛泽东'), 15: ('短歌行', '曹操'),
    24: ('梦游天姥吟留别', '李白'), 36: ('登高', '杜甫'),
    41: ('念奴娇·赤壁怀古', '苏轼'), 45: ('师说', '韩愈'),
    54: ('劝学', '荀子'), 93: ('赤壁赋', '苏轼'),
    105: ('子路、曾皙、冉有、公西华侍坐', '孔子及弟子'),
    114: ('阿房宫赋', '杜牧'), 125: ('六国论', '苏洵'),
    137: ('〈论语〉十二章', '孔子及弟子'), 144: ('大学之道', '《礼记》'),
    153: ('〈老子〉四章', '老子'), 179: ('屈原列传', '司马迁'),
    188: ('过秦论', '贾谊'), 201: ('离骚', '屈原'),
    217: ('蜀道难', '李白'), 240: ('蜀相', '杜甫'),
}
# The source's adjacent notes explicitly identify these four stem errors.
# Keep the answer unchanged and retain each complete original note.
STEM_REPAIRS = {
    31: ('天门山打开', '洞天石门打开'),
    112: ('肯定子路的治国抱负', '肯定公西华的治国抱负'),
    140: ('孔子以“仁”为最高标准', '曾子以“仁”为最高标准'),
    176: ('《老子》第二十四章中', '《老子》第六十四章中'),
}
READER_NOTES = {
    59: '书架现有《劝学》对应句有缺字，本题按所给文件保留“輮使之然也”。',
    202: '书架现有《离骚》对应句有缺字，本题按所给文件保留“鞿羁”。',
    205: '书架现有《离骚》对应句有缺字，本题按所给文件保留“蕙纕”。',
}


def paragraphs():
    with ZipFile(SOURCE) as archive:
        root = ET.fromstring(archive.read('word/document.xml'))
    return list(root.find(W + 'body').iter(W + 'p'))


def runs(paragraph):
    output = []
    for run in paragraph.iter(W + 'r'):
        text = ''.join(node.text or '' for node in run.iter(W + 't'))
        if not text:
            continue
        props = run.find(W + 'rPr')
        color = props.find(W + 'color') if props is not None else None
        underline = props.find(W + 'u') if props is not None else None
        answer = color is not None and color.get(W + 'val', '').upper() == '154F91' and underline is not None
        output.append((text, answer))
    return output


def main():
    rows = paragraphs()
    assert len(rows) == 250
    questions, changes = [], []
    current = None
    for index, paragraph in enumerate(rows):
        parts = runs(paragraph)
        raw = ''.join(text for text, _ in parts).strip()
        if index in HEADINGS:
            current = HEADINGS[index]
            continue
        if raw.startswith('注：'):
            assert questions
            questions[-1]['note'] = (questions[-1]['note'] + '\n' + raw).strip()
            continue
        answers = [text for text, is_answer in parts if is_answer]
        if not answers:
            continue
        assert current
        number = re.match(r'^\s*(?:[（(](\d+)[）)]|(\d+)\s*[、.．])', raw)
        assert number, (index, raw)
        prompt = ''.join('＿＿＿＿' if is_answer else text for text, is_answer in parts)
        prompt = re.sub(r'^\s*(?:[（(]\d+[）)]|\d+\s*[、.．])\s*', '', prompt)
        prompt = re.sub(r'\s+', '', prompt)
        if index in STEM_REPAIRS:
            old, new = STEM_REPAIRS[index]
            assert old in prompt, (index, old)
            original = prompt
            prompt = prompt.replace(old, new, 1)
            changes.append({'paragraph': index, 'originalPrompt': original, 'correctedPrompt': prompt})
        assert prompt.count('＿＿＿＿') == len(answers), (index, prompt, answers)
        questions.append({
            'id': f'recitation:summary:{index:04}', 'work': current[0], 'author': current[1],
            'number': int(number.group(1) or number.group(2)), 'prompt': prompt,
            'answers': answers, 'alternatives': [[] for _ in answers], 'note': '',
            'source': SOURCE_NAME, 'articleId': None,
        })
        if index == 220:
            # The immediately following source note explicitly accepts this
            # alternate pair. It is a whole pair, not two interchangeable lines.
            questions[-1]['alternativeSets'] = [['蚕丛及鱼凫', '开国何茫然']]
    assert len(questions) == 209 and sum(len(q['answers']) for q in questions) == 476
    assert len(changes) == 4 and sum(bool(q['note']) for q in questions) == 13
    for question in questions:
        paragraph = int(question['id'].rsplit(':', 1)[1])
        if paragraph in READER_NOTES:
            question['note'] = (question['note'] + '\n' + READER_NOTES[paragraph]).strip()
    result = {
        'id': 'understanding-recitations-summary-20261105-v1',
        'source': {'file': SOURCE_NAME, 'sha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest()},
        'stats': {'questions': len(questions), 'answers': sum(len(q['answers']) for q in questions), 'works': len(HEADINGS)},
        'stemCorrections': changes,
        'incomplete': [{'work': '陈情表', 'number': 1,
                        'text': ''.join(text for text, _ in runs(rows[249])).strip(),
                        'reason': '题干和答案均未提供完整，保留原样，未作为可背诵题目。'}],
        'questions': questions,
    }
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(result['stats'])


if __name__ == '__main__':
    main()
