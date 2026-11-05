#!/usr/bin/env python3
"""Build the two completed understanding-recall lists supplied in chat."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
source = json.loads((ROOT / 'scripts/recitation-chenlan-source.json').read_text())
works = [('陈情表', '李密', 'chenqingbiao', 21), ('兰亭集序', '王羲之', 'lanting', 16)]
questions = []
for work, author, key, expected in works:
    rows = source[work]
    assert len(rows) == expected
    for number, row in enumerate(rows, 1):
        answers = row['answers']
        assert row['prompt'].count('＿＿＿＿') == len(answers)
        alternatives = row.get('alternatives', [[] for _ in answers])
        assert len(alternatives) == len(answers)
        questions.append({'id': f'recitation:chenlan:{key}:{number:03}', 'work': work, 'author': author,
                          'number': number, 'prompt': row['prompt'], 'answers': answers,
                          'alternatives': alternatives, 'note': row.get('note', ''),
                          'source': '陈情表与兰亭集序补充默写', 'articleId': None})
assert len(questions) == 37 and sum(len(q['answers']) for q in questions) == 75
pack = {'id': 'recitation-chenlan-supplement-20261105-v1',
        'source': '用户在对话中补充的完整题目与答案',
        'stats': {'questions': 37, 'answers': 75, 'works': 2}, 'questions': questions}
(ROOT / 'server/content/recitation-chenlan.json').write_text(json.dumps(pack, ensure_ascii=False, indent=2) + '\n')
print(pack['stats'])
