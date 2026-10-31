"""Prepare only bookshelf texts; do not create vocabulary, senses or annotations."""
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'resources/sources/高中语文五册_文言文古诗词_实词补充整合版.md'
COMPLETION = ROOT / 'resources/sources/陈情表_用户补全文.md'
source = SOURCE.read_text()
articles, warnings = [], []
book = ''
current = None
lines = []


def finish():
    if current is None:
        return
    raw = '\n'.join(lines).strip()
    completed = current['title'] == '陈情表'
    if completed:
        # User-supplied replacement has bold spans crossing several notes and
        # some unbolded explanations. All parentheses in this replacement are notes.
        raw = COMPLETION.read_text().split('\n', 1)[1].strip()
    page = re.match(r'<small>教材页码：([^<]+)</small>\s*', raw)
    if not page:
        raise ValueError(f'缺少页码：{current["title"]}')
    raw = raw[page.end():]

    def original_word(match):
        annotation = match[1]
        word, separator, note = annotation.partition('（')
        if not separator or not word or not note.endswith('）'):
            raise ValueError(f'不能安全分离随文注释：{current["title"]}：{annotation}')
        if annotation.count('（') != annotation.count('）'):
            warnings.append({'title': current['title'], 'sourceFragment': match[0],
                             'note': '注释内部括号不配对；原词边界明确，仅取括号前原词，原注释留在来源文件中。'})
        return word

    # Remove only explicitly bolded word(gloss) markup. Preserve stage directions,
    # source citations and all other parentheses in the supplied original text.
    if completed:
        body_chars, depth = [], 0
        for char in raw.replace('**', ''):
            if char == '（':
                depth += 1
            elif char == '）':
                depth -= 1
                if depth < 0:
                    raise ValueError('陈情表追加文本注释括号不配对')
            elif depth == 0:
                body_chars.append(char)
        if depth:
            raise ValueError('陈情表追加文本注释括号未闭合')
        body = ''.join(body_chars)
    else:
        body = re.sub(r'\*\*(.*?)\*\*', original_word, raw, flags=re.S)
    body = '\n'.join(line.rstrip() for line in body.splitlines()).strip()
    if '**' in body or '<small>' in body or not body:
        raise ValueError(f'正文仍有未处理标记：{current["title"]}')
    status = '已按用户补全文更新，字词待整理' if completed else '原文已上架，字词待整理'
    if not re.search(r'[。！？.!?）》”’]$', body):
        warnings.append({'title': current['title'], 'sourceFragment': body[-40:],
                         'note': '原文件末尾疑似截断，按所给内容保留，待用户补齐。'})
        status = '原文件末尾截断，正文待补'
    key = hashlib.sha256(f'{book}\n{current["title"]}'.encode()).hexdigest()[:20]
    articles.append({'id': f'textbook5:article:{key}', 'title': current['title'],
                     'author': '', 'era': '', 'body': body,
                     'summary': f'{book} · 教材第 {page[1]} 页 · {status}', 'sample': False})


for line in source.splitlines():
    if line.startswith('## '):
        finish()
        current, lines = None, []
        book = line[3:].strip()
    elif match := re.match(r'^### (\d+)\. (.+)$', line):
        finish()
        current, lines = {'title': match[2]}, []
    elif current is not None:
        lines.append(line)
finish()

if len(articles) != 71 or len({a['id'] for a in articles}) != 71:
    raise ValueError('篇目数量或编号不符，停止生成')
pack = {'id': 'textbook-five-volumes-20261031-v1', 'sourceFile': SOURCE.name,
        'sourceSha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        'completionSource': {'file': COMPLETION.name, 'sha256': hashlib.sha256(COMPLETION.read_bytes()).hexdigest()},
        'articles': articles, 'warnings': warnings}
(ROOT / 'server/content/textbook-articles.json').write_text(json.dumps(pack, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'articles': len(articles), 'byVolume': dict(Counter(a['summary'].split(' · ')[0] for a in articles)),
                  'characters': sum(len(a['body']) for a in articles), 'formatWarnings': warnings}, ensure_ascii=False))
