#!/usr/bin/env python3
"""Extract only the understanding-based recitation questions, not other exercises.

Place the three supplied files in ignored resources/local-sources/ before running.
Answers are reviewed separately in recitation-answers.json; no document instructions
are executed. PDF extraction requires pdftotext.
"""
import hashlib
import json
import re
import subprocess
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / 'resources/local-sources'
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
SPECS = [
    ('陈情表', '李密', 'chenqingbiao', '李密《陈情表》情景默写.docx', 42),
    ('离骚', '屈原', 'lisao', '《离骚》周末作业（2026.9.19）.docx', 20),
    ('兰亭集序', '王羲之', 'lanting', '《兰亭集序》作业docx.pdf', 15),
]


def extract(path):
    if path.suffix == '.pdf':
        text = subprocess.check_output(['pdftotext', '-layout', str(path), '-']).decode()
        text = text[re.search(r'(?m)^1\)', text).start():]
        text = re.sub(r'\n\s*1\s*\f?\s*$', '', text)
        pattern = r'(?m)^\s*(\d+)[)）]'
    else:
        with ZipFile(path) as archive:
            document = ET.fromstring(archive.read('word/document.xml'))
        text = '\n'.join(''.join(node.text or '' for node in p.iter(W + 't'))
                         for p in document.find(W + 'body').iter(W + 'p'))
        if '陈情表' in path.name:
            text = text[:text.index('《祭十二郎文》')]
            pattern = r'(?m)^（(\d+)）'
        else:
            text = text[text.index('二、理解性默写') + len('二、理解性默写'):]
            pattern = r'(?m)^(\d+)\.'
    matches = list(re.finditer(pattern, text))
    result = []
    for i, match in enumerate(matches):
        raw = text[match.end():matches[i + 1].start() if i + 1 < len(matches) else len(text)].strip()
        prompt = re.sub(r'_{2,}|[ \u00a0]{3,}', '＿＿＿＿', raw)
        prompt = re.sub(r'\s+', '', prompt)
        prompt = re.sub(r'＿+', '＿＿＿＿', prompt)
        # The first blank of 陈情表 q26 consists solely of NBSPs in the DOCX.
        if '陈情表' in path.name and int(match[1]) == 26:
            prompt = prompt.replace('晋朝“”', '晋朝“＿＿＿＿”')
        result.append((int(match[1]), prompt))
    return result


def main():
    answers = json.loads((ROOT / 'scripts/recitation-answers.json').read_text())
    questions, sources = [], []
    for work, author, key, filename, count in SPECS:
        path = SOURCES / filename
        rows = extract(path)
        assert len(rows) == count == len(answers[work]), (work, len(rows))
        assert [number for number, _ in rows] == list(range(1, count + 1))
        sources.append({'file': filename, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'questions': count})
        for number, prompt in rows:
            answer = answers[work][number - 1]
            assert prompt.count('＿＿＿＿') == len(answer), (work, number, prompt, answer)
            note, alternatives = '', [[] for _ in answer]
            if work == '陈情表' and number == 33:
                alternatives[0] = ['但以刘日薄西山']
                note = '首空也可连同上文写作“但以刘日薄西山”。'
            if work == '陈情表' and number == 28:
                alternatives[0] = ['臣少仕伪朝']
            if work == '陈情表' and number == 12:
                alternatives[0] = ['刘夙婴疾病']
            if work == '兰亭集序' and number in (1, 2, 10, 11):
                alternatives[0] = [{1: '崇山峻岭', 2: '清流激湍', 10: '修短随化', 11: '一死生为虚诞'}[number]]
            if work == '兰亭集序' and number == 3:
                alternatives[1] = ['崇山峻岭']
            if work == '陈情表' and number == 7:
                note = '按课文写“零丁”，注意不要误写为“伶仃”。'
            if work == '离骚' and number == 5:
                note = '鞿羁（jījī）、謇（jiǎn）、谇（suì）；注意“鞿”字不可漏写。'
            if work == '离骚' and number == 14:
                note = '纕（xiāng）、茝（chǎi）；注意不要漏掉“蕙纕”的“纕”。'
            questions.append({'id': f'recitation:{key}:{number:03}', 'work': work, 'author': author,
                              'number': number, 'prompt': prompt, 'answers': answer,
                              'alternatives': alternatives, 'note': note, 'source': filename, 'articleId': None})
    result = {'id': 'understanding-recitation-20261105-v1', 'sources': sources,
              'answerReferences': [
                  {'work': '陈情表', 'reference': '现有书架《陈情表》完整原文'},
                  {'work': '离骚', 'url': 'https://www.gushiwen.cn/shiwenv_1997f465971c.aspx', 'reference': '原文及生僻字核对'},
                  {'work': '兰亭集序', 'url': 'https://www.dpm.org.cn/lemmas/245215.html', 'reference': '故宫博物院《兰亭序》释文核对；通假字沿用题目课文写法'},
              ], 'questions': questions}
    (ROOT / 'server/content/recitation.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print({work: sum(q['work'] == work for q in questions) for work, *_ in SPECS})


if __name__ == '__main__':
    main()
