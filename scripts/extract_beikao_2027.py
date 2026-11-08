#!/usr/bin/env python3
"""Extract the 2027 备考 extracurricular pieces 《乌有先生传》 and 《吴樘传》.

Usage: python scripts/extract_beikao_2027.py SOURCE.docx OUTPUT.json

《乌有先生传》: eight 原文 paragraphs with supplied paragraph translations and
numbered 勾连教材实例 entries (word glosses + textbook example lines). The
source marks no positions, so every gloss is pinned to an occurrence in the
body: unique words resolve automatically, everything else goes through the
explicit PIN table below. Every pin is asserted against the body.

《吴樘传》: colored inline annotations. Red parentheses are word glosses,
green/blue parentheses are culture notes appended to the body as numbered
notes. Gloss words come from the annotation key or, failing that, from the
text right before the parentheses; a supplied-text typo (服阙) is corrected
and recorded. Every gloss position is asserted.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import zipfile

from xml.etree import ElementTree

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
REDS = {'FF0000', 'FB0007', 'C00000', 'CC0000'}
NOTE_COLORS = {'70AD47', '5B9BD5', '2E74B5', '7030A0'}
BODY_COLORS = {None, '000000', 'auto', '333333'}
PYIN = 'āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ'
PYIN_RE = re.compile(r'(?<=[\u4e00-\u9fff])[a-zA-Z]*[' + PYIN + r'][a-zA-Z]*')
FUNCTION_HEADS = '而其之于为与所者也以'

# Numbers absent from the source's own 勾连教材实例 numbering (1–200).
SOURCE_GAPS = {131, 132, 133}

# 勾连教材实例 entry number → how to pin the gloss inside the body. 'pin'
# locates the occurrence (the snippet must contain the word); 'word' /
# 'meaning' replace the parsed values for pattern entries whose literal form
# is not in the body. Entries with several occurrences whose first occurrence
# already carries the glossed sense stay unpinned (auto = first occurrence).
PINS: dict[int, dict] = {
    7:   {'pin': '年七十有三'},
    39:  {'pin': '与老妻计曰'},
    41:  {'pin': '投村落辟焉'},
    42:  {'word': '无乃', 'meaning': '固定结构，“恐怕[莫非]……吧”'},
    49:  {'word': '奈之何', 'meaning': '固定结构，“拿……怎么办”'},
    53:  {'word': '窃', 'meaning': '“窃为……”句式，私下认为（原条目未单独释义，对照《鸿门宴》“窃为大王不取也”）'},
    84:  {'word': '得无'},
    56:  {'pin': '先生然之'},
    71:  {'pin': '方踌躇间'},
    85:  {'pin': '电光下孰视之'},
    86:  {'pin': '抱一死婴，且顾且号'},
    93:  {'word': '何', 'meaning': '固定结构，“要……干什么？”“哪里用得着……呢？”', 'pin': '何惧为'},
    95:  {'pin': '厉声曰：“女鬼邪'},
    98:  {'pin': '毛发上指'},
    96:  {'word': '抑', 'meaning': '“……邪？抑……邪？”，选择性句式，译为“是……呢，还是……呢？”'},
    116: {'word': '其', 'meaning': '“其……乎？”固定句式，难道……吗？', 'pin': '其欲血孤刀'},
    125: {'word': '特', 'meaning': '“特……耳”：“只是……罢了”。延：请；恨：遗憾。', 'pin': '特以不得延医'},
    126: {'pin': '惟大王哀之'},
    130: {'pin': '以救乃友'},
    145: {'pin': '馁虎见于林莽'},
    149: {'pin': '不意今乃捐躯'},
    150: {'pin': '不意今乃捐躯'},
    153: {'pin': '盖一矢已贯其喉'},
    155: {'pin': '衣短褐'},
    160: {'pin': '先生具白所以'},
    164: {'pin': '遂引至其家'},
    170: {'pin': '吾当与君具往'},
    175: {'word': '不亦'},
    182: {'pin': '偕先生就而问焉'},
    183: {'pin': '述向之所见'},
    185: {'word': '所', 'meaning': '被动结构，“为……所……”', 'pin': '为恶姑所容'},
    187: {'pin': '发其子之坟'},
    189: {'pin': '是倍义尔'},
    190: {'pin': '困于酒耳'},
    191: {'pin': '若何为者也'},
    193: {'pin': '公觉，谢曰'},
    195: {'pin': '恶能报'},
    196: {'word': '何功之有'},
    198: {'word': '止', 'meaning': '“止（直）……耳”固定句式，只是……罢了。', 'pin': '止济世活人耳'},
    199: {'word': '何以', 'meaning': '固定结构，“要……做什么呢？”“哪里用得着……呢？”', 'pin': '何以金帛为'},
}

# Supplied-text typos inside 吴樘传 annotations: annotation key → body form.
WUCHEN_CORRECTIONS = {'服阙': '服阕'}

# Keyless annotations whose glossed word is not the full CJK run before the
# parentheses (matched by the start of the annotation text).
WUCHEN_RUN_OVERRIDES = {
    '指黄河的水清了': '河清海晏',
    '官吏到职理政': '视事',
    '害怕失败': '畏衄',
    '通“讽”': '风',
    '安定；安居': '安堵',
}

CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟'


def clean(text: str) -> str:
    return text.replace('\xa0', ' ').strip()


def strip_pinyin(word: str) -> str:
    return re.sub(r'[（(][^（）()]*[a-zA-Z' + PYIN + r'][^（）()]*[）)]', '', word).strip()


def strip_meaning_parens(meaning: str) -> str:
    meaning = meaning.strip()
    if len(meaning) >= 2 and meaning[0] in '（(' and meaning[-1] in '）)':
        meaning = meaning[1:-1].strip()
    return meaning


def find_all(text: str, needle: str) -> list[int]:
    out, at = [], text.find(needle)
    while at >= 0:
        out.append(at)
        at = text.find(needle, at + 1)
    return out


def read_paragraphs(path: str) -> list[str]:
    with zipfile.ZipFile(path) as archive:
        root = ElementTree.fromstring(archive.read('word/document.xml'))
    return [clean(''.join(n.text or '' for n in p.iter(W + 't'))) for p in root.iter(W + 'p')]


# ---------------------------------------------------------------- 乌有先生传
def extract_wuyou(paras: list[str]) -> dict:
    bodies, i = [], 0
    while i < len(paras):
        if re.fullmatch(r'第[一二三四五六七八]段', paras[i]):
            j = i + 1
            while j < len(paras) and paras[j] != '原文':
                j += 1
            assert j + 1 < len(paras), '第N段后没有原文标签'
            k = j + 1
            while k < len(paras) and not paras[k]:
                k += 1
            bodies.append(paras[k])
            i = k + 1
        else:
            i += 1
    assert len(bodies) == 8, f'乌有先生传应 8 段原文，得到 {len(bodies)}'
    body = '\n'.join(bodies)
    assert '勾连' not in body and '译文' not in body and '原文' not in body

    entries, state, section = [], None, False
    num_re = re.compile(r'^(\d{1,3})\s*[\.．]\s*(.+)$')
    for text in paras:
        if not text:
            continue
        if text == '勾连教材实例':
            section, state = True, None
            continue
        if text == '译文' or re.fullmatch(r'第[一二三四五六七八]段', text) \
                or text.startswith('【') or text == '常考知识点汇总' or text.startswith('高考高效'):
            if state:
                entries.append(state)  # the block's last entry ends at the boundary
                state = None
            section = False
            continue
        if not section:
            continue
        m = num_re.match(text)
        if m and state:
            entries.append(state)
            state = None
        if m:
            rest = m.group(2)
            cm = re.match(r'^(.*?)[：:]\s*(.*)$', rest)
            if cm:
                word, meaning = cm.group(1), strip_meaning_parens(cm.group(2))
            else:
                qm = re.match(r'^(.*?[？?])(.*)$', rest)
                word, meaning = (qm.group(1), strip_meaning_parens(qm.group(2))) if qm else (rest, '')
            state = {'num': int(m.group(1)), 'word': word.strip(), 'meaning': meaning.strip(), 'examples': []}
            continue
        if state is None:
            continue
        if '《' in text or text.startswith('成语'):
            sm = re.match(r'^(.*?)\s*(?:《([^》]*)》)?\s*$', text)
            state['examples'].append({'text': sm.group(1).strip(),
                                      'source': sm.group(2) or ('成语' if text.startswith('成语') else '')})
        else:
            state['meaning'] = (state['meaning'] + '；' + text).strip()
    if state:
        entries.append(state)

    numbers = [e['num'] for e in entries]
    expected = set(range(1, 201)) - SOURCE_GAPS
    assert set(numbers) == expected, f'编号异常：缺 {sorted(expected - set(numbers))}，多 {sorted(set(numbers) - expected)}'
    assert len(numbers) == len(set(numbers)), '编号出现重复'

    for e in entries:
        rule = PINS.get(e['num'], {})
        e['word'] = rule.get('word', strip_pinyin(e['word']))
        e['meaning'] = rule.get('meaning', e['meaning'])
        assert e['word'] and e['meaning'], f'#{e["num"]} 词或释义为空：{e["word"]!r} {e["meaning"]!r}'

    glosses, unpinned_multi = [], []
    for e in entries:
        rule = PINS.get(e['num'], {})
        word = e['word']
        if 'pin' in rule:
            snippet = rule['pin']
            hits = find_all(body, snippet)
            assert len(hits) == 1, f'#{e["num"]} 对位片段不唯一：{snippet} → {len(hits)} 处'
            offset = snippet.find(word)
            assert offset >= 0, f'#{e["num"]} 对位片段不含目标词：{snippet} / {word}'
            start = hits[0] + offset
        else:
            hits = find_all(body, word)
            assert hits, f'#{e["num"]} 正文找不到：{word}'
            if len(hits) > 1:
                unpinned_multi.append((e['num'], word, len(hits)))
            start = hits[0]
        assert body[start:start + len(word)] == word, f'#{e["num"]} 定位失败'
        glosses.append({'word': word, 'meaning': e['meaning'], 'articleStart': start,
                        'ref': f'乌有-{e["num"]:03d}', 'issue': None})
    for a in glosses:
        for b in glosses:
            if a['ref'] >= b['ref']:
                continue
            assert a['articleStart'] + len(a['word']) <= b['articleStart'] \
                or b['articleStart'] + len(b['word']) <= a['articleStart'], f'词解范围重叠：{a["ref"]} 与 {b["ref"]}'

    translations = []
    cursor = 0
    for index, source in enumerate(bodies, 1):
        start = body.index(source, cursor)
        cursor = start + len(source)
        translations.append({'id': f'beikao2027:translation:wuyou-{index:03d}',
                             'articleStart': start, 'source': source, 'translation': ''})
    seen, i = 0, 0
    while i < len(paras) and seen < 8:
        if paras[i] == '译文':
            j = i + 1
            while j < len(paras) and not paras[j]:
                j += 1
            assert j < len(paras), '译文标签后没有内容'
            translations[seen]['translation'] = paras[j]
            seen += 1
            i = j + 1
        else:
            i += 1
    assert seen == 8, f'译文仅找到 {seen} 段'
    assert all(t['translation'] for t in translations)

    lexicon, unresolved = [], []
    for e in entries:
        for ex in e['examples']:
            text = re.sub(r'^（[^（）]*）', '', ex['text']).strip()
            source = ex['source']
            row = {'ref': f'乌有-{e["num"]:03d}', 'word': e['word'], 'text': text, 'source': source, 'issue': None}
            if not text:
                unresolved.append({**row, 'issue': '原资料只有出处没有例句。'})
                continue
            hits = find_all(text, e['word'])
            if not hits:
                unresolved.append({**row, 'issue': '例句中找不到目标词，仅留档。'})
                continue
            row['start'] = hits[0]
            assert text[row['start']:row['start'] + len(e['word'])] == e['word']
            if len(hits) > 1:
                row['issue'] = f'目标词出现 {len(hits)} 处，位置待核对。'
            lexicon.append(row)

    print('乌有先生传 未加对位但多处出现的词条（默认取首现，需人工核对首现即该释义）：')
    for num, word, count in unpinned_multi:
        first = find_all(body, word)[0]
        print(f'  #{num} {word} ×{count} 首现：…{body[max(0, first - 10):first + len(word) + 10]}…')
    return {
        'id': 'beikao2027:article:wuyou', 'title': '乌有先生传', 'author': '', 'era': '',
        'body': body, 'summary': '2027高考备考资料·课外文言材料（附段落译文与勾连教材实例）',
        'translations': translations, 'glosses': glosses,
        'lexiconExamples': lexicon, 'unresolved': unresolved,
    }


# ---------------------------------------------------------------- 吴樘传
WUCHEN_SKIP_EXACT = {'【提升版】', '作者说明', '传主档案',
                     '注：绿字为文化常识，红字为实词虚词解释及译文，蓝字为其他备注。'}
WUCHEN_SKIP_PREFIX = ('高考高效', '一读——', '二读——', '三读——', '姓名：', '生卒年：', '举进士时间：',
                      '偶像：', '政敌：', '老板：', '官职属性：', '本文虚构')


def extract_wuchen(paras: list[str], docx: str) -> dict:
    with zipfile.ZipFile(docx) as archive:
        root = ElementTree.fromstring(archive.read('word/document.xml'))
    all_paras = list(root.iter(W + 'p'))
    xml_texts = [clean(''.join(n.text or '' for n in p.iter(W + 't'))) for p in all_paras]
    xml_start = next(i for i, t in enumerate(xml_texts) if t.startswith('【提升版】'))

    body_paras, notes, raw_glosses, fails, citations = [], [], [], [], []
    strays, adjustments = [], []
    for para in all_paras[xml_start + 1:]:
        chars = []
        for run in para.iter(W + 'r'):
            color = None
            rpr = run.find(W + 'rPr')
            if rpr is not None and rpr.find(W + 'color') is not None:
                color = rpr.find(W + 'color').get(W + 'val')
            for ch in ''.join(n.text or '' for n in run.iter(W + 't')):
                chars.append((ch, color))
        text = clean(''.join(c for c, _ in chars))
        if not text or text in WUCHEN_SKIP_EXACT or text.startswith(WUCHEN_SKIP_PREFIX):
            continue
        if re.fullmatch(r'（选自[^（）]*）', text):
            citations.append(text)
            continue

        plain, annotations = [], []
        i = 0
        while i < len(chars):
            ch, color = chars[i]
            if ch in '（(':
                depth, j, inner = 1, i + 1, []
                while j < len(chars) and depth:
                    c = chars[j][0]
                    if c in '（(':
                        depth += 1
                    elif c in '）)':
                        depth -= 1
                        if not depth:
                            break
                    inner.append(chars[j])
                    j += 1
                assert depth == 0 or j < len(chars), '括号不配对'
                inner_text = ''.join(c for c, _ in inner)
                colors = {col for _, col in inner if col not in BODY_COLORS}
                if colors:
                    kind = 'gloss' if colors & REDS else 'note'
                    annotations.append((kind, inner_text, len(plain)))
                    i = j + 1
                    continue
                if clean(inner_text) and len(clean(inner_text)) <= 60:
                    # Unmarked annotations (言讫、安堵、厌) are glosses like the red ones.
                    annotations.append(('gloss', inner_text, len(plain)))
                    i = j + 1
                    continue
                assert not clean(inner_text), f'正文出现未归类的黑色括号组：{inner_text[:30]}'
            if color not in BODY_COLORS:
                # Highlighted body text (e.g. 蜂起、剽掠): keep the character, log the color.
                strays.append((color, ch))
            plain.append(ch)
            i += 1

        paragraph = PYIN_RE.sub('', ''.join(plain))
        pending = []
        cuts = [(kind, inner, len(PYIN_RE.sub('', ''.join(plain)[:raw_cut])))
                for kind, inner, raw_cut in annotations]
        prev_bound = 0  # a gloss may not reach across the previous annotation
        for kind, inner, cut in cuts:
            inner = clean(inner)
            if kind == 'note':
                if inner:
                    notes.append(inner)
                continue
            # Split into glosses at 。 only when the parts carry their own keys;
            # keyless sentences continue the preceding gloss's meaning.
            subs = [clean(p) for p in inner.split('。') if clean(p)]
            resolved = []
            if not any(re.search(r'[：:]', s) for s in subs):
                run = re.search(r'[\u4e00-\u9fff]+$', paragraph[prev_bound:cut])
                assert run, f'吴樘传夹注前找不到正文：{inner[:20]}'
                word = run.group(0)
                for head, forced in WUCHEN_RUN_OVERRIDES.items():
                    if inner.startswith(head):
                        word = forced
                        break
                if len(word) >= 2 and word[0] in FUNCTION_HEADS:
                    word = word[1:]
                resolved.append((word, inner))
            else:
                for index, sub in enumerate(subs):
                    km = re.match(r'^(.*?)[：:]\s*(.*)$', sub)
                    if not km:
                        if resolved:
                            resolved[-1] = (resolved[-1][0], resolved[-1][1] + '。' + sub)
                        continue
                    key = strip_pinyin(km.group(1))
                    key = re.sub(r'[a-zA-Z' + PYIN + r']+', '', key)  # bare pinyin in keys (觇chān、畿jī)
                    key = WUCHEN_CORRECTIONS.get(key, key)
                    resolved.append((key, clean(km.group(2))))
            merged = []
            for word, meaning in resolved:
                low = max(prev_bound, cut - 24)
                at = paragraph.rfind(word, low, cut)
                used = word
                if at < 0:
                    # The annotation may gloss a full idiom while the body uses a short form.
                    for size in range(len(word) - 1, 0, -1):
                        probe = word[:size]
                        at = paragraph.rfind(probe, low, cut)
                        if at >= 0 and cut - (at + len(probe)) <= 3:
                            adjustments.append({'where': '吴樘传夹注', 'original': word, 'corrected': probe,
                                                'reason': '夹注按全称解释，正文用字为简称，按正文定位。'})
                            used = probe
                            break
                if at < 0:
                    fails.append(('position', word, inner[:30]))
                    continue
                assert cut - (at + len(used)) <= 3, f'吴樘传定位过远：{word} @ {paragraph[max(0, at - 8):at + 12]}'
                prev = merged[-1] if merged else None
                if prev and at < prev[0] + len(prev[1]) and prev[0] < at + len(used):
                    keep, keep_at = (prev[1], prev[0]) if len(prev[1]) >= len(used) else (used, at)
                    parts = sorted([(prev[1], prev[2]), (used, meaning)], key=lambda x: -len(x[0]))
                    merged[-1] = (keep_at, keep, '；'.join(f'{w}：{m}' for w, m in parts))
                else:
                    merged.append((at, used, meaning))
            for at, word, _ in merged:
                assert paragraph[at:at + len(word)] == word, f'吴樘传定位失败：{word}'
            prev_bound = cut
            for at, word, meaning in merged:
                assert paragraph[at:at + len(word)] == word, f'吴樘传定位失败：{word}'
                pending.append((word, meaning, at))
        body_paras.append(paragraph)
        for word, meaning, at in pending:
            base = sum(len(p) for p in body_paras[:-1]) + len(body_paras) - 1
            raw_glosses.append({'word': word, 'meaning': meaning, 'articleStart': base + at})

    assert len(body_paras) == 11, f'吴樘传应 11 段正文，得到 {len(body_paras)}'
    body = '\n'.join(body_paras)
    cm = re.search(r'（选自[^（）]*）$', body)
    if cm:
        citations.append(cm.group(0))
        body = body[:cm.start()]
    assert '盗版' not in body and '虚构人物' not in body and '文化常识：' not in body
    assert not re.search(r'[a-zA-Z]', body), '正文残留拉丁字母（拼音未剥净）'

    glosses, refs = [], set()
    for g in sorted(raw_glosses, key=lambda r: r['articleStart']):
        ref = f'吴樘-{len(glosses) + 1:03d}'
        refs.add(ref)
        glosses.append({**g, 'ref': ref, 'issue': None})
    for a in glosses:
        for b in glosses:
            if a['ref'] >= b['ref']:
                continue
            assert a['articleStart'] + len(a['word']) <= b['articleStart'] \
                or b['articleStart'] + len(b['word']) <= a['articleStart'], f'词解范围重叠：{a["word"]} 与 {b["word"]}'
    assert not fails, f'吴樘传未解析的夹注：{fails}'
    assert len(strays) < 120, f'正文高亮字符异常增多：{len(strays)}'
    print(f'吴樘传 正文中的彩色高亮（保留原字）：{"".join(dict.fromkeys(f"{c}{ch}" for c, ch in strays))[:200]} …共 {len(strays)} 字符')
    numbered_notes = ''.join(f'{CIRCLED[i]}{note}' for i, note in enumerate(notes))
    if numbered_notes:
        body += '\n\n[注释]' + numbered_notes

    return {
        'id': 'beikao2027:article:wuchen', 'title': '吴樘传', 'author': '', 'era': '明',
        'body': body, 'summary': '2027高考备考资料·课外文言材料（仿《明史》体例的虚构传记，附文化常识原注）',
        'translations': [], 'glosses': glosses, 'lexiconExamples': [], 'unresolved': [],
        'citations': citations, 'notesCount': len(notes), 'adjustments': adjustments,
    }


def main():
    docx, out = sys.argv[1], sys.argv[2]
    paras = read_paragraphs(docx)
    wuyou = extract_wuyou(paras)
    wuchen = extract_wuchen(paras, docx)
    articles = [wuyou, wuchen]
    stats = {
        'articles': len(articles),
        'glosses': sum(len(a['glosses']) for a in articles),
        'translations': sum(len(a['translations']) for a in articles),
        'lexiconExamples': sum(len(a['lexiconExamples']) for a in articles),
        'unresolved': sum(len(a['unresolved']) for a in articles),
    }
    result = {
        'id': 'beikao2027-wuyou-wuchen-20261108-v1',
        'sourceFile': docx.split('\\')[-1].split('/')[-1],
        'sourceSha256': hashlib.sha256(open(docx, 'rb').read()).hexdigest(),
        'corrections': [{'where': '吴樘传夹注', 'original': '服阙', 'corrected': '服阕',
                         'reason': '正文用字为“服阕”，夹注笔误按正文订正。'}] + wuchen.pop('adjustments', []),
        'stats': stats, 'articles': articles,
    }
    with open(out, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(stats, ensure_ascii=False))
    print('吴樘传 citations:', wuchen['citations'], 'notes:', wuchen['notesCount'])


if __name__ == '__main__':
    main()
