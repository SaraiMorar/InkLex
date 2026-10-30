import { emptyDatabase, saveContext, sentenceAt, type Article } from './model.ts';

const articles: Article[] = [
  { id: 'sample-xiaoshitan', title: '小石潭记', author: '柳宗元', era: '唐', sample: true,
    summary: '一潭清水，一段幽静的山水记忆。',
    body: '从小丘西行百二十步，隔篁竹，闻水声，如鸣珮环，心乐之。伐竹取道，下见小潭，水尤清冽。全石以为底，近岸，卷石底以出，为坻，为屿，为嵁，为岩。青树翠蔓，蒙络摇缀，参差披拂。\n\n潭中鱼可百许头，皆若空游无所依。日光下澈，影布石上，佁然不动；俶尔远逝，往来翕忽，似与游者相乐。\n\n潭西南而望，斗折蛇行，明灭可见。其岸势犬牙差互，不可知其源。\n\n坐潭上，四面竹树环合，寂寥无人，凄神寒骨，悄怆幽邃。以其境过清，不可久居，乃记之而去。\n\n同游者：吴武陵，龚古，余弟宗玄。隶而从者，崔氏二小生，曰恕己，曰奉壹。' },
  { id: 'sample-loushi', title: '陋室铭', author: '刘禹锡', era: '唐', sample: true,
    summary: '斯是陋室，惟吾德馨。',
    body: '山不在高，有仙则名。水不在深，有龙则灵。斯是陋室，惟吾德馨。\n\n苔痕上阶绿，草色入帘青。谈笑有鸿儒，往来无白丁。可以调素琴，阅金经。无丝竹之乱耳，无案牍之劳形。\n\n南阳诸葛庐，西蜀子云亭。孔子云：“何陋之有？”' },
  { id: 'sample-ailian', title: '爱莲说', author: '周敦颐', era: '宋', sample: true,
    summary: '出淤泥而不染，濯清涟而不妖。',
    body: '水陆草木之花，可爱者甚蕃。晋陶渊明独爱菊。自李唐来，世人甚爱牡丹。予独爱莲之出淤泥而不染，濯清涟而不妖，中通外直，不蔓不枝，香远益清，亭亭净植，可远观而不可亵玩焉。\n\n予谓菊，花之隐逸者也；牡丹，花之富贵者也；莲，花之君子者也。噫！菊之爱，陶后鲜有闻。莲之爱，同予者何人？牡丹之爱，宜乎众矣。' },
];
const annotations: [string, string, string, string?][] = [
  ['sample-xiaoshitan', '篁竹', '竹林'], ['sample-xiaoshitan', '乐', '以……为乐', '心乐之'],
  ['sample-xiaoshitan', '尤', '格外'], ['sample-xiaoshitan', '清冽', '清凉'],
  ['sample-xiaoshitan', '可', '大约', '鱼可百许头'], ['sample-xiaoshitan', '许', '表示约数', '百许头'],
  ['sample-xiaoshitan', '佁然', '静止不动的样子'], ['sample-xiaoshitan', '俶尔', '忽然'],
  ['sample-xiaoshitan', '翕忽', '轻快迅疾的样子'], ['sample-xiaoshitan', '犬牙', '像狗的牙齿一样'],
  ['sample-xiaoshitan', '清', '凄清', '境过清'], ['sample-xiaoshitan', '居', '停留'],
  ['sample-xiaoshitan', '去', '离开', '乃记之而去'],
  ['sample-loushi', '名', '出名，有名'], ['sample-loushi', '斯', '这'], ['sample-loushi', '馨', '能散布很远的香气，这里指德行美好'],
  ['sample-loushi', '鸿儒', '博学的人'], ['sample-loushi', '白丁', '平民，这里指没有功名的人'],
  ['sample-loushi', '调', '调弄'], ['sample-loushi', '案牍', '官府文书'], ['sample-loushi', '形', '形体、躯体'],
  ['sample-ailian', '蕃', '多'], ['sample-ailian', '濯', '洗'], ['sample-ailian', '妖', '艳丽'],
  ['sample-ailian', '益', '更加'], ['sample-ailian', '植', '竖立'], ['sample-ailian', '亵', '亲近而不庄重'],
  ['sample-ailian', '鲜', '少'], ['sample-ailian', '宜', '应当'],
];

export function createSeed() {
  let data = emptyDatabase();
  data.articles = articles;
  for (const [articleId, word, meaning, anchor] of annotations) {
    const article = articles.find(a => a.id === articleId)!;
    const articleStart = anchor ? article.body.indexOf(anchor) + anchor.indexOf(word) : article.body.indexOf(word);
    const sentence = sentenceAt(article.body, articleStart);
    data = saveContext(data, { word, meaning, note: '', articleId, articleStart, ...sentence,
      source: `《${article.title}》`, verified: true });
  }
  for (const [word, meaning, text, source] of [
    ['顾', '看', '顾野有麦场。', '《狼》'],
    ['顾', '拜访', '三顾臣于草庐之中。', '《出师表》'],
    ['顾', '拜访', '将军宜枉驾顾之。', '《隆中对》'],
    ['去', '离开', '去国怀乡，忧谗畏讥。', '《岳阳楼记》'],
  ]) data = saveContext(data, { word, meaning, text, source, start: text.indexOf(word), note: '', articleId: null, articleStart: null, verified: true });
  return data;
}
