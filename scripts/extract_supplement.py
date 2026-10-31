"""Rebuild the source-preserving supplement. Inputs are text extracted from user files."""
import re,json,hashlib
from pathlib import Path
root=Path(__file__).resolve().parents[1]; src=root/'resources/sources'
rows=[]; rejected=[]; senses=[]
def clean(s):return s.replace('\u200b','').strip()
def add(pack,ref,word,meaning,text,source='',note='',issue=''):
 word=word.strip();meaning=meaning.strip(' 。；;');text=text.strip()
 if text.startswith(('（','(')):
  text=text[1:];text=text[:-1] if text.endswith(('）',')')) else text
 if not meaning or not word: rejected.append(dict(pack=pack,ref=ref,word=word,raw=text,reason='缺少明确释义'));return
 senses.append((word,meaning))
 # Extract only the terminal citation, leaving book titles inside sentences intact.
 m=re.search(r'[（(]?(《[^《》]+》)[）)]*$',text)
 if m:source=m[1];text=text[:m.start()].rstrip(' （(')
 # Explanation parentheses stay as source notes rather than part of the classical quotation.
 comments=re.findall(r'（([^（）]*)）',text)
 if comments:note+=' 原文附注：'+'；'.join(comments);text=re.sub(r'（[^（）]*）','',text)
 positions=[m.start() for m in re.finditer(re.escape(word),text)]
 if not positions:
  rejected.append(dict(pack=pack,ref=ref,word=word,meaning=meaning,raw=text,source=source,reason='例句未出现目标字词'));return
 if pack=='18虚词' and (str(ref) in ['14.1','18.1','70.1','92.1','117.1']):issue='原例句或出处疑有误，需核对。'
 if any(text.count(a)!=text.count(b) for a,b in [('（','）'),('(',')'),('“','”')]):issue=issue or '原句括号或引号不完整，需核对。'
 if len(positions)>1:issue=issue or '同句目标字词出现多次，需核对本义项对应的位置。'
 if '""' in meaning or '“”' in meaning:issue='原资料通假字缺失，需核对。'
 rows.append(dict(pack=pack,ref=str(ref),word=word,meaning=meaning,text=text,start=len(text[:positions[0]].encode('utf-16-le'))//2,source=source,note=note,issue=issue))
# Table-based high frequency collection. Exam dates/counts are source claims, not verified facts.
bad={5,12,14,36,49,58,75,81,94,96,109,112,117,126,128,131,134,138,141,145,148,164,171,175,185,199,202,204,216,219,222,228,229,237,241,244,246,247,256}
word=''
for _,i,cells in json.loads((src/'高频实词表.json').read_text()):
 if i==0:continue
 w,f,m,t,s=cells
 if w:word=re.sub(r'^\d+\.\s*','',w)
 add('高频实词',i,word,re.sub(r'^[①-⑳]\s*','',m),t,s,'试卷出处与频次为资料原标，未经独立核验。', '原释义、例句或出处疑似错配，需核对。' if i in bad else '')
# Mixed outline formats in the 150-word markdown.
word=meaning=category=''; compound=''; headings=[]
for i,line in enumerate((src/'150实词.md').read_text().splitlines(),1):
 line=clean(line)
 h=re.fullmatch(r'\*\*(\d+)、(.+?)\*\*',line) or (re.fullmatch(r'(24)、(殆)',line))
 if h:word=re.match(r'[\u4e00-\u9fff]+',h[2])[0];headings.append(word);meaning=category=compound='';continue
 if not word or not line:continue
 if re.fullmatch(r'[A-Za-zāáǎàēéěèīíǐìōóǒòūúǔùǚǜü]+(?: 动词。)?',line):continue
 if not re.search(r'[\u4e00-\u9fff]',line):continue
 if re.fullmatch(r'(?:[a-zǎāáà]+ )?(?:名|动|形容|副|介|代|连|助|量)词。',line):category=line.strip('。');meaning='';continue
 m=re.match(r'^（\d+）(.+)',line)
 if m:
  line=m[1];meaning='';compound=''
  if re.match(r'^(?:名|动|形容|副|介|代|连|助|量|数)词|^复合词',line):
   category=line.split('。')[0]
   line=line.split('。',1)[1] if '。' in line else ''
   if not line:continue
 num=re.match(r'^(?:[①-⑳]|\d+[、．.]?|[ⅰⅱⅲⅳⅴ]+[、．.])\s*(.*)',line)
 if num:line=num[1];meaning=''
 # These sections use definition: quotation(short citation), sometimes twice per line.
 if word in ['兴','行','幸','引'] and num and '：' in line:
  meaning,examples=line.rsplit('：',1)
  target=word
  if word=='行' and meaning.startswith('行李：'):target='行李';meaning=meaning.split('：',1)[1]
  for j,example in enumerate(re.finditer(r'([^（）()]+)[（(]([^（）()]+)[）)]',examples)):
   add('150实词',f'{i}.{j+1}',target,meaning,re.sub('[• ]','',example[1]),'原资料简称：'+example[2])
  continue
 if i==205:meaning=line.strip('。');continue # Parentheses here explain 伯/孟, not a quotation.
 if word=='末' and num:
  quoted=re.match(r'^<名>(.+?)。([^“]+)：“(.+)”$',line)
  if quoted:add('150实词',i,word,quoted[1],quoted[3],quoted[2]);continue
 # Inline "definition。（example）" and standalone example lines.
 inline=re.match(r'^(.*?)。[（(](.+)[）)]?$',line) or re.match(r'^(.*?)[。]?[（(](.+)[）)]?$',line)
 if inline and (num or m):
  meaning=inline[1]; example=inline[2].rstrip('）)');
  if word not in example and word in meaning:
   if '：' in meaning:
    meaning,example=meaning.rsplit('：',1);example=re.sub('[• ]','',example)
   elif not example.startswith('《'):meaning,example=example,meaning
  elif word not in example and not re.search('《',example):
   meaning=line.strip('。');continue
  add('150实词',i,word,meaning,example,note='原资料分类：'+category);continue
 if num or m:
  meaning=line.strip('。')
  # Compound expressions explicitly defined with a colon become their own entries.
  cm=re.match(r'^([\u4e00-\u9fff]{2,5})[：:](.+)',meaning)
  compound=cm[1] if cm and cm[1].find(word)>=0 else ''
  if compound:meaning=cm[2]
  continue
 if re.match(r'^[A-Za-zāáǎàēéěèīíǐìōóǒòūúǔùǚǜü]+',line):continue
 if meaning:
  add('150实词',i,compound or word,meaning,line,note=('原资料分类：'+category) if category else '')
 else:rejected.append(dict(pack='150实词',ref=i,word=word,raw=line,reason='未能确定释义与例句关系'))
# Particle outline: parent categories + numbered usages + circled examples.
word=category=meaning=''; particle_heads=[]
for i,line in enumerate((src/'18虚词.txt').read_text().splitlines(),1):
 line=clean(line)
 if not line:continue
 h=re.match(r'^\d+[．.]【(.+?)】',line)
 if h:word=base=h[1];alternatives=[word];particle_heads.append(word);category=meaning='';continue
 if not word:continue
 # Six Arabic-numbered quotations occur among circled examples; retain the current usage.
 if i in [473,476,480,482,483,484]:line=re.sub(r'^\d+\.\s*','①',line)
 parts=re.split(r'(?=[①-⑳])',line)
 lead=parts.pop(0)
 if lead:
  c=re.match(r'^（[一二三四五六七八九十]+）(.+)',lead)
  if c:word=base;alternatives=[word];category=c[1];meaning='';lead=c[1]
  co=re.match(r'^(?:【[^】]+】)+',lead)
  if co:
   words=re.findall(r'【([^】]+)】',co[0]);word=words[0];category='复合用法';meaning=lead[co.end():]
   # Multiple equivalent compounds: use the one actually present in each example below.
   alternatives=words
  else:
   alternatives=[word]
   n=re.search(r'(?:^|\s)\d+[．.、]\s*(.+)',lead)
   if n:meaning=n[1];category=re.sub(r'\s*\d+[．.].*','',category)
   elif c:meaning=lead
   elif not lead.startswith('['):meaning=lead
 for j,part in enumerate(parts):
  text=part[1:].strip(); alternatives=[base] if any('…' in w for w in alternatives) else alternatives; target=next((w for w in alternatives if w in text),word)
  add('18虚词',f'{i}.{j+1}',target,(category+'；'+meaning) if category and category!=meaning else meaning,text)
# Resolve four exceptional layouts explicitly; retain questionable wording for review.
manual = {
  428: ('辞', '一种文体', '《归去来兮辞》', '', '原资料仅提供篇名，保留为文体用例。'),
  601: ('得', '所愿', '于彼计则得。', '《中山狼》', '原资料排版混合，释义需核对。'),
  1102: ('善', '喜欢、羡慕', '善乃物之得时，感吾生之行休', '', '原句“乃物”疑为“万物”，需核对。'),
  1246: ('涕', '哭泣', '士皆垂泪涕泣', '', '')
}
for ref,(w,m,t,source,issue) in manual.items():
 if ref==428:t='篇名《归去来兮辞》'
 add('150实词',str(ref)+'a',w,m,t+'。' if ref==428 else t,source,issue=issue)
rejected=[r for r in rejected if not (r['pack']=='150实词' and r['ref'] in manual)]
# Explicit source/layout corrections; original extracted files remain unchanged for comparison.
for row in rows:
 if row['pack']=='150实词':
  corrections={
   '354':('守城','李应庚发两路兵城南城。','《宋史•李庭芝传》'),
   '689':('鼓（乐器）','瞽奏鼓','《书•胤征》'),
   '1008':('限定和约定的时间、时日（名词）','道不通，度以失期 后会有期',''),
   '1009':('约定（动词）','君与家君期日中，日中不至，则是无信 不期而遇',''),
   '1563':('奔向、趋附','窃计欲亡赵走燕','')
  }
  if row['ref'] in corrections:
   row['meaning'],row['text'],row['source']=corrections[row['ref']]
   row['start']=row['text'].index(row['word'])
   row['note']+=' 已整理括号与附注排版。'
   row['issue']='同句目标字词出现多次，需核对本义项对应的位置。' if row['text'].count(row['word'])>1 else ''
 if row['pack']=='150实词' and row['ref']=='1200':
  row['text']='遂逐齐师';row['start']=0;row['issue']='';row['note']+=' 原资料括号错位，已拆出《曹刿论战》出处。'
 if row['pack']=='150实词' and row['ref'] in ['368','829','938','960','1053','1458']:
  row['issue']='原句疑有错漏字，需对照出处核对。'
 if row['pack']=='18虚词' and row['ref'] in ['406.1','552.1','603.1','483.1']:
  row['issue']='原分类、句中文字或释义疑有误，需核对。'
# Remove exact duplicates within the extracted source; preserve all rejection records.
unique={}
for r in rows:unique.setdefault((r['pack'],r['word'],r['meaning'],r['text'],r['start']),r)
rows=list(unique.values())
result={'id':'supplement-20261031-v1','records':rows,'unresolved':rejected,'sourceHashes':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in src.iterdir()},'headings':{'150实词':headings,'18虚词':particle_heads}}
(root/'server/content/supplement.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
for pack in ['高频实词','150实词','18虚词']:
 rr=[r for r in rows if r['pack']==pack];print(pack,len(set(r['word'] for r in rr)),len(rr),'pending',sum(bool(r['issue']) for r in rr),'unresolved',sum(r['pack']==pack for r in rejected))
print('headings',len(headings),len(particle_heads))
