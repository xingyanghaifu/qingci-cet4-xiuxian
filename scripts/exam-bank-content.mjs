/**
 * 中学考试题库的内容素材（v1.9.0 阶段 A/B 共用）
 *
 * 这里只放**素材**，不放组卷逻辑（组卷在 build-exam-bank.mjs）。
 * 分三类：
 *   1. 词池 POOLS —— 供完形/阅读/选词的句子槽位取词；
 *   2. 语法框架 GRAMMAR_FRAMES —— 语法选择题的句子框架与**已内嵌的正确答案**；
 *   3. 篇章骨架 CLOZE/READING/BANKFILL + 写作任务 WRITING。
 *
 * 设计底线（题库是给初中生看的，不能糊弄）：
 *   · 正确答案必须**由框架本身决定**，绝不在运行时「判断」谁对；
 *   · 槽位要**词性容错**：`The ___ is important.` 里放名词，随便哪个都语法成立；
 *     反之 `I bought a new ___` 就会撞上不可数名词（a information ✗），这类框架一律不用；
 *   · 词池词必须来自词组语料（build 阶段断言 ⊆ wordlist），不凭空造词。
 *
 * 变量标记约定：
 *   大写槽位 `{NAME}` `{PLACE}` `{TIME}` `{NUM}` `{N1}` `{A1}` `{R1}` `{V1}`
 *   —— 读到大写键即为「需要填的空」（完形/选词）或「已知事实」（阅读，由 facts 取值）。
 */

/* =========================== 1. 词池 =========================== */

/** 人物名（阅读题细节题的「谁」） */
export const NAMES = [
  'Li Hua', 'Wang Ming', 'Zhang Wei', 'Liu Ying', 'Chen Jie', 'Zhao Lei', 'Han Meimei',
  'Jim', 'Mary', 'Tom', 'Lucy', 'Lily', 'Jack', 'Kate', 'Dave', 'Anna', 'Peter', 'Sara',
];

/**
 * 上面这些名字里明确是女性的 —— `{HISHER}` 要按人名取 he/she 系物主代词。
 * 硬写成 'his' 会出现 "Mary … his family" 这种中学生一眼看出的低级错误；
 * 张伟/李华这类看不出性别的按 'his' 处理（虚构语境，可接受）。
 */
export const FEMININE = new Set(['Liu Ying', 'Han Meimei', 'Mary', 'Lucy', 'Lily', 'Kate', 'Anna', 'Sara']);

/** 地点（「哪里」） */
export const PLACES = [
  'library', 'park', 'zoo', 'museum', 'supermarket', 'cinema', 'hospital', 'bookshop',
  'sports centre', 'town', 'village', 'beach', 'mountain', 'farm', 'station', 'restaurant',
];

/**
 * 时间槽（**星期**，不是「yesterday / last week」）。
 *
 * 这是有意收窄的：骨架里的时间前缀是 `Last ___` / `On ___` / `One ___` /
 * `every ___`，只有星期能同时接住这四种 —— 填进 `yesterday` 会得到
 * `Last yesterday` 这种病句。题干的正确性优先于时间词的多样性。
 */
export const TIMES = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];

/** 数量（「多少」） */
export const NUMS = ['two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'twelve'];

/** 名词池：具体可数、语义宽泛，放进 `The ___ is important.` 这类容错槽位都成立。
 *  末尾一排**元音开头**的词是给 a/an 题用的（否则 a 题永远选 a，练不到 an）。 */
export const NOUNS = [
  'apple', 'bike', 'book', 'box', 'bag', 'bus', 'cake', 'camera', 'chair', 'class',
  'coat', 'computer', 'cup', 'desk', 'door', 'dress', 'egg', 'farm', 'film', 'flower',
  'food', 'friend', 'garden', 'gift', 'grape', 'hall', 'house', 'kite', 'kitchen', 'knife',
  'lake', 'lamp', 'letter', 'map', 'market', 'meal', 'mirror', 'moon', 'mountain', 'movie',
  'nurse', 'office', 'orange', 'park', 'party', 'pen', 'phone', 'photo', 'picture', 'place',
  'plane', 'plant', 'plate', 'postcard', 'present', 'radio', 'restaurant', 'river', 'road', 'robot',
  'school', 'shelf', 'ship', 'shirt', 'shoe', 'shop', 'sister', 'song', 'sport', 'star',
  'station', 'stone', 'store', 'story', 'street', 'student', 'table', 'team', 'tent', 'ticket',
  'tiger', 'tomato', 'tower', 'town', 'toy', 'train', 'tree', 'trip', 'truck', 'umbrella',
  'vegetable', 'village', 'wall', 'window', 'word', 'yard', 'zebra',
  // ↑ 末尾这些是**元音开头**的词（a/an 题要靠它们才练得到 an）；
  //   前面 apple/egg/orange/umbrella 已出现过，这里不能重复，否则会撞出重复题干。
  'animal', 'ant', 'answer', 'area', 'arm', 'aunt', 'island', 'insect', 'ice', 'idea',
  'ink', 'elephant', 'engine', 'onion', 'ear', 'eye', 'act', 'actor', 'age', 'aim',
];

/** 评价类形容词：`The story is ___` / `The film is ___` 里放谁都通顺 */
export const ADJ_QUALITY = [
  'interesting', 'boring', 'important', 'beautiful', 'wonderful', 'great', 'nice', 'good', 'bad',
  'easy', 'difficult', 'hard', 'popular', 'famous', 'funny', 'strange', 'useful', 'helpful',
  'modern', 'ancient', 'quiet', 'busy', 'friendly', 'careful', 'lucky', 'healthy', 'strong',
  'weak', 'rich', 'poor', 'clean', 'dirty', 'cheap', 'expensive', 'safe', 'dangerous',
  'exciting', 'relaxing', 'delicious', 'fantastic', 'terrible', 'common', 'special',
];

/** 颜色类形容词：只放进 `a ___ dress` 这种不会撞语义的框架 */
export const ADJ_COLOR = [
  'red', 'blue', 'green', 'black', 'white', 'yellow', 'brown', 'purple', 'grey', 'pink',
];

/**
 * 副词池（`He runs ___` / `She did it ___`）。
 *
 * 这里只列**确实在初中词表里**的副词：早先混进 quickly/slowly/carefully 等
 * 10 个词，交集过滤后只剩 17 个 —— 选词题的副词槽只有两个，
 * 17 个词在 14 个变体里反复撞车，导致大量篇章同词同空被判重复。
 * 池子放大到 ~50 后，撞车概率降到原来的 1/9。
 * 刻意不含 lonely/lovely/friendly/family 这类「-ly 结尾但不是副词」的词。
 */
export const ADVS = [
  'early', 'late', 'soon', 'again', 'already', 'yet', 'still', 'too', 'very', 'quite',
  'rather', 'almost', 'never', 'always', 'often', 'seldom', 'sometimes', 'together', 'alone', 'really',
  'perhaps', 'maybe', 'probably', 'nearly', 'hardly', 'first', 'then', 'also', 'once', 'ever',
  'here', 'there', 'outside', 'inside', 'abroad', 'away', 'back', 'well', 'easily', 'especially',
  'immediately', 'casually', 'daily', 'possibly', 'specially', 'specifically',
];

/** 基本动词（原形）：用于 `I often ___ with my friends.` 这类原形槽位 */
export const VERBS_BASE = [
  'go', 'come', 'run', 'walk', 'jump', 'swim', 'climb', 'sit', 'stand', 'open', 'close',
  'read', 'write', 'draw', 'sing', 'dance', 'play', 'watch', 'listen', 'look', 'see', 'hear',
  'speak', 'say', 'tell', 'ask', 'help', 'give', 'take', 'bring', 'buy', 'sell', 'use',
  'find', 'win', 'try', 'start', 'finish', 'begin', 'learn', 'teach', 'study', 'remember',
  'think', 'know', 'understand', 'hope', 'want', 'need', 'like', 'love', 'enjoy', 'feel',
  'touch', 'wash', 'cook', 'eat', 'drink', 'sleep', 'wear', 'change', 'move', 'live',
  'stay', 'meet', 'visit', 'travel', 'arrive', 'leave', 'wait', 'call', 'follow', 'share',
  'thank', 'invite', 'practice', 'exercise', 'worry', 'smile', 'laugh', 'cry', 'push',
  'pull', 'throw', 'catch', 'break', 'fix', 'build', 'plant', 'grow', 'pick', 'drive',
  'ride', 'count', 'choose', 'decide', 'plan', 'promise', 'agree', 'refuse', 'borrow',
  'lend', 'return', 'check', 'test', 'pass', 'describe', 'explain', 'prepare', 'serve',
];

/**
 * 动词变位表（语法选择的时态/语态框架专用）。
 * 只做**框架已知正确**的题：正确项由这张表给出，干扰项是同一动词的其它形态，
 * 不需要在运行时判断语法对错。
 * irregular: 不规则动词已标 true（规则动词按 +s/+ed/+ing 直接推导）。
 */
export const VERB_FORMS = [
  { b: 'go', s: 'goes', p: 'went', pp: 'gone', ing: 'going' },
  { b: 'come', s: 'comes', p: 'came', pp: 'come', ing: 'coming' },
  { b: 'get', s: 'gets', p: 'got', pp: 'got', ing: 'getting' },
  { b: 'make', s: 'makes', p: 'made', pp: 'made', ing: 'making' },
  { b: 'take', s: 'takes', p: 'took', pp: 'taken', ing: 'taking' },
  { b: 'give', s: 'gives', p: 'gave', pp: 'given', ing: 'giving' },
  { b: 'see', s: 'sees', p: 'saw', pp: 'seen', ing: 'seeing' },
  { b: 'find', s: 'finds', p: 'found', pp: 'found', ing: 'finding' },
  { b: 'know', s: 'knows', p: 'knew', pp: 'known', ing: 'knowing' },
  { b: 'think', s: 'thinks', p: 'thought', pp: 'thought', ing: 'thinking' },
  { b: 'tell', s: 'tells', p: 'told', pp: 'told', ing: 'telling' },
  { b: 'write', s: 'writes', p: 'wrote', pp: 'written', ing: 'writing' },
  { b: 'read', s: 'reads', p: 'read', pp: 'read', ing: 'reading' },
  { b: 'eat', s: 'eats', p: 'ate', pp: 'eaten', ing: 'eating' },
  { b: 'drink', s: 'drinks', p: 'drank', pp: 'drunk', ing: 'drinking' },
  { b: 'begin', s: 'begins', p: 'began', pp: 'begun', ing: 'beginning' },
  { b: 'become', s: 'becomes', p: 'became', pp: 'become', ing: 'becoming' },
  { b: 'bring', s: 'brings', p: 'brought', pp: 'brought', ing: 'bringing' },
  { b: 'buy', s: 'buys', p: 'bought', pp: 'bought', ing: 'buying' },
  { b: 'catch', s: 'catches', p: 'caught', pp: 'caught', ing: 'catching' },
  { b: 'choose', s: 'chooses', p: 'chose', pp: 'chosen', ing: 'choosing' },
  { b: 'do', s: 'does', p: 'did', pp: 'done', ing: 'doing' },
  { b: 'draw', s: 'draws', p: 'drew', pp: 'drawn', ing: 'drawing' },
  { b: 'drive', s: 'drives', p: 'drove', pp: 'driven', ing: 'driving' },
  { b: 'fall', s: 'falls', p: 'fell', pp: 'fallen', ing: 'falling' },
  { b: 'feel', s: 'feels', p: 'felt', pp: 'felt', ing: 'feeling' },
  { b: 'fly', s: 'flies', p: 'flew', pp: 'flown', ing: 'flying' },
  { b: 'forget', s: 'forgets', p: 'forgot', pp: 'forgotten', ing: 'forgetting' },
  { b: 'get', s: 'gets', p: 'got', pp: 'got', ing: 'getting' },
  { b: 'give', s: 'gives', p: 'gave', pp: 'given', ing: 'giving' },
  { b: 'grow', s: 'grows', p: 'grew', pp: 'grown', ing: 'growing' },
  { b: 'have', s: 'has', p: 'had', pp: 'had', ing: 'having' },
  { b: 'hear', s: 'hears', p: 'heard', pp: 'heard', ing: 'hearing' },
  { b: 'hold', s: 'holds', p: 'held', pp: 'held', ing: 'holding' },
  { b: 'keep', s: 'keeps', p: 'kept', pp: 'kept', ing: 'keeping' },
  { b: 'leave', s: 'leaves', p: 'left', pp: 'left', ing: 'leaving' },
  { b: 'lose', s: 'loses', p: 'lost', pp: 'lost', ing: 'losing' },
  { b: 'meet', s: 'meets', p: 'met', pp: 'met', ing: 'meeting' },
  { b: 'pay', s: 'pays', p: 'paid', pp: 'paid', ing: 'paying' },
  { b: 'put', s: 'puts', p: 'put', pp: 'put', ing: 'putting' },
  { b: 'run', s: 'runs', p: 'ran', pp: 'run', ing: 'running' },
  { b: 'say', s: 'says', p: 'said', pp: 'said', ing: 'saying' },
  { b: 'see', s: 'sees', p: 'saw', pp: 'seen', ing: 'seeing' },
  { b: 'sell', s: 'sells', p: 'sold', pp: 'sold', ing: 'selling' },
  { b: 'sing', s: 'sings', p: 'sang', pp: 'sung', ing: 'singing' },
  { b: 'sit', s: 'sits', p: 'sat', pp: 'sat', ing: 'sitting' },
  { b: 'sleep', s: 'sleeps', p: 'slept', pp: 'slept', ing: 'sleeping' },
  { b: 'speak', s: 'speaks', p: 'spoke', pp: 'spoken', ing: 'speaking' },
  { b: 'spend', s: 'spends', p: 'spent', pp: 'spent', ing: 'spending' },
  { b: 'stand', s: 'stands', p: 'stood', pp: 'stood', ing: 'standing' },
  { b: 'swim', s: 'swims', p: 'swam', pp: 'swum', ing: 'swimming' },
  { b: 'take', s: 'takes', p: 'took', pp: 'taken', ing: 'taking' },
  { b: 'teach', s: 'teaches', p: 'taught', pp: 'taught', ing: 'teaching' },
  { b: 'throw', s: 'throws', p: 'threw', pp: 'thrown', ing: 'throwing' },
  { b: 'understand', s: 'understands', p: 'understood', pp: 'understood', ing: 'understanding' },
  { b: 'wear', s: 'wears', p: 'wore', pp: 'worn', ing: 'wearing' },
  { b: 'win', s: 'wins', p: 'won', pp: 'won', ing: 'winning' },
  { b: 'write', s: 'writes', p: 'wrote', pp: 'written', ing: 'writing' },
  { b: 'do', s: 'does', p: 'did', pp: 'done', ing: 'doing' },
  /* —— 补一批常见**规则动词**：被动语态的「主语—动词配对」和时态框架都要用到 ——
     build/carry/clean/use/plant/serve/lock 等原本不在表里，配对时会落到
     「pp 按 +ed 硬造」的兜底，use/use、build/built 这类容易造错。 */
  { b: 'build', s: 'builds', p: 'built', pp: 'built', ing: 'building' },
  { b: 'carry', s: 'carries', p: 'carried', pp: 'carried', ing: 'carrying' },
  { b: 'clean', s: 'cleans', p: 'cleaned', pp: 'cleaned', ing: 'cleaning' },
  { b: 'use', s: 'uses', p: 'used', pp: 'used', ing: 'using' },
  { b: 'plant', s: 'plants', p: 'planted', pp: 'planted', ing: 'planting' },
  { b: 'serve', s: 'serves', p: 'served', pp: 'served', ing: 'serving' },
  { b: 'lock', s: 'locks', p: 'locked', pp: 'locked', ing: 'locking' },
  { b: 'cook', s: 'cooks', p: 'cooked', pp: 'cooked', ing: 'cooking' },
  { b: 'wash', s: 'washes', p: 'washed', pp: 'washed', ing: 'washing' },
  { b: 'watch', s: 'watches', p: 'watched', pp: 'watched', ing: 'watching' },
  { b: 'help', s: 'helps', p: 'helped', pp: 'helped', ing: 'helping' },
  { b: 'finish', s: 'finishes', p: 'finished', pp: 'finished', ing: 'finishing' },
  { b: 'start', s: 'starts', p: 'started', pp: 'started', ing: 'starting' },
  { b: 'stop', s: 'stops', p: 'stopped', pp: 'stopped', ing: 'stopping' },
  { b: 'open', s: 'opens', p: 'opened', pp: 'opened', ing: 'opening' },
  { b: 'close', s: 'closes', p: 'closed', pp: 'closed', ing: 'closing' },
  { b: 'play', s: 'plays', p: 'played', pp: 'played', ing: 'playing' },
  { b: 'walk', s: 'walks', p: 'walked', pp: 'walked', ing: 'walking' },
  { b: 'talk', s: 'talks', p: 'talked', pp: 'talked', ing: 'talking' },
  { b: 'work', s: 'works', p: 'worked', pp: 'worked', ing: 'working' },
];

/** 不可数名词黑名单：`I bought a new ___` 会撞上 a information ✗，组词时一律剔除 */
export const UNCOUNTABLE = new Set([
  'information', 'advice', 'news', 'weather', 'furniture', 'equipment', 'music', 'money',
  'water', 'rice', 'bread', 'milk', 'homework', 'housework', 'knowledge', 'health', 'luck',
  'fun', 'trouble', 'progress', 'research', 'grass', 'rain', 'snow', 'wind', 'air', 'oil',
  'salt', 'sugar', 'cotton', 'paper', 'work', 'time', 'help', 'travel', 'sport', 'food',
]);

/* =========================== 2. 语义子池（槽位的场景约束） =========================== */

/**
 * 槽位写成 `{A1@weather}` 表示「只从 weather 这个子池里取词」。
 *
 * 不加约束的后果（都是真的抽样出来过的问题）：
 *   · The weather was **hard**        ← 通用形容词池里的 hard 配天气不成立
 *   · a blue **market** and a red **onion**  ← 颜色词后面接了不能着色的东西
 *   · buy a **ear** for her father    ← 礼物槽抓到了身体部位
 * 这些句子语法都对，但语义荒唐 —— 对初中生是反面教材。
 *
 * 词是否可用以**词表交集**为准：不在初中词表里的会被过滤掉（build 时打印余量）。
 */
export const SLOTS = {
  /** 天气：The weather was ___ */
  weather: ['nice', 'bad', 'good', 'cold', 'hot', 'warm', 'wet', 'dry', 'fine', 'cloudy', 'sunny', 'terrible', 'wonderful'],
  /** 一次外出/一天的感受：It was ___ but nobody wanted to go home */
  outing: ['nice', 'great', 'wonderful', 'good', 'exciting', 'special', 'interesting', 'busy'],
  /** 野餐/活动形容词：a ___ picnic */
  picnic: ['nice', 'good', 'great', 'wonderful', 'big'],
  /** 场所状态：The reading room is ___ */
  room: ['quiet', 'clean', 'nice', 'big', 'bright', 'modern'],
  /** 人物感受：She looked ___ / he felt ___ */
  feel: ['nervous', 'worried', 'afraid', 'sad', 'tired', 'upset', 'surprised', 'proud'],
  /** 正向心情：How ___ he was! */
  glad: ['happy', 'glad', 'proud', 'excited', 'surprised', 'lucky'],
  /** 累/饿：Though he was ___ */
  tired: ['tired', 'hungry', 'busy', 'thirsty', 'weak'],
  /** 老师的态度：the teacher was ___ with him */
  kind: ['happy', 'pleased', 'angry', 'strict', 'kind'],
  /** 校园/环境变好：make the yard ___ / looked ___ after cleaning */
  green: ['clean', 'nice', 'beautiful', 'tidy', 'bright', 'quiet'],
  /** 海边：The sea was ___ */
  sea: ['blue', 'calm', 'clean', 'clear'],
  /** 路边小物：a small ___ near the road */
  road: ['stone', 'tree', 'shop', 'house', 'sign', 'flower', 'bridge', 'tower'],
  /** 生日礼物：buy a ___ for her father */
  gift: ['watch', 'camera', 'radio', 'kite', 'book', 'bag', 'cap', 'scarf', 'wallet', 'dictionary'],
  /** 可着色物品：a blue ___ / a red ___ */
  colour: ['dress', 'bag', 'cap', 'jacket', 'shoe', 'bike', 'kite', 'pen', 'hat', 'ball', 'box'],
  /** 起床时间副词：gets up ___ */
  morning: ['early', 'late'],
  /** 频率副词：He ___ eats breakfast */
  freq: ['always', 'never', 'often', 'sometimes', 'seldom', 'usually', 'already', 'still'],
  /** 课后消遣方式：walked ___ / played ___ */
  leisure: ['together', 'alone', 'outside', 'inside', 'again', 'well', 'happily', 'quickly'],
  /** …的场所：The library is the ___ place for reading */
  placeAdj: ['best', 'quiet', 'nice', 'good', 'great', 'small'],

  /* —— 以下是 SLOTS 专用的**动词池**，按语态/时态分开 ——
     完形短文是过去时叙事，`the children play happily` 这种原形会破坏时态；
     而 `can ___` / `to ___` / `often ___` 后面又必须是原形。
     故意分出 play（原形）与 playPast（过去式）两套，槽位按句子选。
     这些词形不参与「词表交集」过滤：ran/won 本身就是课标词 run/win 的变形，
     且完形解释里不要求它们的词条释义。 */
  flat: ['table', 'plate', 'bench', 'desk', 'box', 'cloth', 'ground'],
  food: ['apple', 'cake', 'egg', 'orange', 'tomato', 'bread', 'banana', 'grape', 'vegetable', 'milk', 'beef', 'noodle'],
  /** 原形（can/to/often 之后） */
  play: ['play', 'run', 'walk', 'sing', 'dance', 'laugh', 'sit', 'talk', 'jump', 'swim'],
  goish: ['go', 'come', 'walk', 'run', 'drive', 'ride'],
  harm: ['cut', 'break', 'pick', 'pull', 'touch'],
  /** 过去式（叙事句直接作谓语） */
  playPast: ['played', 'ran', 'walked', 'sang', 'danced', 'laughed', 'sat', 'talked', 'jumped', 'swam'],
  goPast: ['went', 'came', 'ran', 'walked', 'drove', 'got'],
  winPast: ['won', 'beat', 'got', 'passed', 'finished'],
  sayPast: ['thanked', 'smiled', 'nodded', 'looked', 'talked'],
  tendPast: ['watered', 'washed', 'cleaned', 'checked'],
  departPast: ['left', 'visited', 'reached', 'entered'],

  /* —— 场景名词子池（完形/选词里与句子场景强相关的名词槽）—— */
  fac: ['library', 'room', 'desk', 'table', 'computer', 'playground', 'garden', 'office', 'hall'],
  schoolObj: ['pen', 'ruler', 'bag', 'book', 'chair', 'map', 'rubbish', 'chalk'],
  hobby: ['football', 'basketball', 'swimming', 'drawing', 'singing', 'dancing', 'reading', 'running'],
  adult: ['coach', 'teacher', 'father', 'friend', 'mother', 'brother', 'parent'],
  home: ['home', 'village', 'house', 'town', 'street', 'hotel'],
  heavyObj: ['bag', 'box', 'basket', 'case', 'stone', 'suitcase'],
  litter: ['paper', 'bottle', 'box', 'bag', 'cup', 'newspaper'],
  plantN: ['tree', 'flower', 'grass', 'rose', 'plant'],
  act: ['act', 'step', 'change', 'thing', 'effort', 'try'],
  place: ['town', 'village', 'island', 'hill', 'bay', 'park'],
  scene: ['sea', 'mountain', 'tree', 'house', 'tower', 'flower', 'beach', 'sky'],

  /* —— 选词填空的场景子池 —— */
  habit: ['good', 'great', 'useful', 'important', 'helpful', 'nice'],
  help: ['help', 'support', 'call', 'find', 'teach', 'save'],
  talk: ['openly', 'freely', 'seriously', 'quietly', 'politely'],
  fit: ['healthy', 'fit', 'strong', 'happy', 'young'],
  eat: ['eat', 'have', 'buy', 'cook', 'grow'],
  known: ['well', 'often', 'always', 'commonly', 'widely'],
  curious: ['curious', 'careful', 'serious', 'excited', 'strict'],
  note: ['read', 'review', 'check', 'keep', 'write'],
  method: ['study', 'learning', 'reading', 'working', 'teaching'],
  makeFeel: ['happy', 'tired', 'busy', 'strong', 'lucky', 'young'],
  memory: ['memory', 'fun', 'joy', 'story', 'time', 'photo', 'day'],
  fresh: ['fresh', 'clean', 'cool', 'clear', 'sweet'],
  do: ['do', 'finish', 'start', 'check', 'share'],
  won: ['finally', 'quickly', 'easily', 'also', 'never'],
  team: ['communication', 'teamwork', 'cooperation', 'work', 'spirit'],
  brave: ['brave', 'strong', 'busy', 'lucky', 'careful', 'serious'],
  fail: ['try', 'fail', 'lose', 'start', 'wait'],
  really: ['really', 'truly', 'clearly', 'often', 'also'],
  chance: ['chance', 'job', 'way', 'place', 'future'],
  study: ['carefully', 'quickly', 'well', 'quietly', 'again'],

  /* —— 阅读篇章的场景子池 —— */
  subject: ['math', 'English', 'music', 'art', 'science', 'history'],
  light: ['light', 'lamp', 'sun', 'moon'],
  bookish: ['book', 'newspaper', 'magazine', 'story', 'picture'],
  collar: ['collar', 'rope', 'string'],
  rainGear: ['umbrella', 'coat', 'raincoat', 'hat'],
  work: ['hospital', 'school', 'shop', 'office', 'library', 'bank'],
  moral: ['kind', 'brave', 'helpful', 'careful', 'honest'],
  rememberPast: ['remembered', 'missed', 'thanked', 'liked', 'thought'],
  laughPast: ['laughed', 'smiled', 'clapped', 'cheered', 'cried'],
  farmAnimal: ['cow', 'pig', 'sheep', 'goat', 'hen', 'duck'],
  crop: ['vegetable', 'carrot', 'potato', 'corn', 'apple', 'cotton'],
  yard: ['yard', 'field', 'ground', 'house', 'room'],
  vehicle: ['bike', 'bus', 'car', 'horse'],
  homework: ['homework', 'reading', 'work', 'job'],
  cleanObj: ['floor', 'window', 'desk', 'chair', 'blackboard'],
  neighbour: ['friendly', 'kind', 'helpful', 'careful', 'serious'],
  talkV: ['talk', 'sing', 'dance', 'shout', 'laugh'],
  support: ['join', 'support', 'love', 'know', 'help'],
  itemAdj: ['nice', 'cheap', 'beautiful', 'new', 'small', 'popular'],
  easy: ['easy', 'simple', 'possible', 'quick', 'short'],
  sportPlace: ['playground', 'field', 'ground', 'sports field'],
};

/* =========================== 2b. 语法选择框架 =========================== */

/**
 * 每个框架返回一道**唯一正解**的题。
 *
 *   · `ctx.i`      —— 第几个变体（决定取哪些词，保证题不重复）
 *   · `ctx.pickN`  —— 取一个名词，`ctx.pickA` 形容词、`ctx.pickR` 副词、
 *                     `ctx.pickVerb` 取一条动词变位、`ctx.pickAdj` 取评价形容词
 *   · 返回 `{ prompt, choices, answer, explain }`，`explain` 用中文写明考查点
 *
 * 判定正解的三条路（都是**生成期算好的**，运行时只做比对）：
 *   1. 结构决定：`than` 后面只能是比较级、`enjoy` 后面只能是 -ing；
 *   2. 表格决定：时态/语态的正确项直接查 VERB_FORMS；
 *   3. 首字母决定：a/an 由后面那个词的读音首字母决定。
 *
 * 刻意避开的坑：所有 4 个选项都合语法的框架（如 `The book is ___ the desk`
 * 里的 in/on）一律不写 —— 那是含糊题，会教坏学生。
 */
export const GRAMMAR_FRAMES = [
  /* ---- 冠词：a/an 由空格后那个词的首字母决定 ---- */
  {
    tag: 'article',
    rule: '不定冠词 a/an 的选用',
    make: (ctx) => {
      const n = ctx.pickN(ctx.i, 0);
      const vowel = /^[aeiou]/i.test(n);
      const correct = vowel ? 'an' : 'a';
      return {
        prompt: `I saw ___ ${n} in the park yesterday.`,
        choices: shuffle4(vowel ? ['an', 'a', 'the', '—'] : ['a', 'an', 'the', '—']),
        answer: correct,
        explain: `空格后是 ${n}，首字母 ${n[0]} 读${vowel ? '元音' : '辅'}音，用 ${correct}。`,
      };
    },
  },
  {
    tag: 'article',
    rule: '定冠词 the 的特指用法',
    make: () => ({
      prompt: 'Look at ___ moon. It is so bright tonight.',
      choices: shuffle4(['the', 'a', 'an', '—']),
      answer: 'the',
      explain: 'moon 是世界上独一无二的东西，用定冠词 the。',
    }),
  },
  {
    tag: 'article',
    rule: '球类运动前不加冠词',
    make: (ctx) => {
      const sport = ['football', 'basketball', 'table tennis', 'volleyball'][ctx.i % 4];
      return {
        prompt: `My brother plays ___ ${sport} with his classmates after school.`,
        choices: shuffle4(['—', 'a', 'an', 'the']),
        answer: '—',
        explain: `球类运动名词前不加冠词，play ${sport} 直接接。`,
      };
    },
  },
  {
    tag: 'article',
    rule: '乐器名词前加 the',
    make: (ctx) => {
      const inst = ['piano', 'violin', 'guitar', 'trumpet'][ctx.i % 4];
      return {
        prompt: `She can play ___ ${inst} very well.`,
        choices: shuffle4(['the', 'a', 'an', '—']),
        answer: 'the',
        explain: `乐器名词前加定冠词：play the ${inst}。`,
      };
    },
  },

  /* ---- 介词：由时间/地点标志词唯一决定 ---- */
  {
    tag: 'preposition',
    rule: '点钟前用 at',
    make: (ctx) => {
      const t = ['8 o\'clock', 'noon', 'night', 'midnight', 'six in the evening'][ctx.i % 5];
      return {
        prompt: `The train leaves ___ ${t} every day.`,
        choices: shuffle4(['at', 'on', 'in', 'to']),
        answer: 'at',
        explain: `具体钟点（${t}）前用 at。`,
      };
    },
  },
  {
    tag: 'preposition',
    rule: '具体某天前用 on',
    make: (ctx) => {
      const d = ['Monday', 'Friday', 'my birthday', 'Children\'s Day', 'New Year\'s Day'][ctx.i % 5];
      return {
        prompt: `We are going to have a party ___ ${d}.`,
        choices: shuffle4(['on', 'in', 'at', 'for']),
        answer: 'on',
        explain: `具体某一天（${d}）前用 on。`,
      };
    },
  },
  {
    tag: 'preposition',
    rule: '月份/年份/季节前用 in',
    make: (ctx) => {
      const t = ['June', '2010', 'summer', 'autumn', 'the future'][ctx.i % 5];
      return {
        prompt: `My sister was born ___ ${t}.`.replace('in ', 'in '),
        choices: shuffle4(['in', 'on', 'at', 'by']),
        answer: 'in',
        explain: `${t} 表示较长的时间（月份/年份/季节），用 in。`,
      };
    },
  },
  {
    tag: 'preposition',
    rule: '固定搭配 be good at',
    make: (ctx) => {
      const act = ['English', 'maths', 'swimming', 'drawing', 'playing the violin'][ctx.i % 5];
      return {
        prompt: `She is good ___ ${act}.`,
        choices: shuffle4(['at', 'in', 'on', 'for']),
        answer: 'at',
        explain: '固定搭配 be good at（擅长……）。',
      };
    },
  },
  {
    tag: 'preposition',
    rule: '固定搭配 be interested in',
    make: (ctx) => {
      const t = ['science', 'history', 'music', 'nature', 'learning new words'][ctx.i % 5];
      return {
        prompt: `They are interested ___ ${t}.`,
        choices: shuffle4(['in', 'at', 'on', 'to']),
        answer: 'in',
        explain: '固定搭配 be interested in（对……感兴趣）。',
      };
    },
  },

  /* ---- 连词 / 句型：结构唯一 ---- */
  {
    tag: 'conjunction',
    rule: 'so…that 句型',
    make: (ctx) => {
      const a = ['careful', 'clever', 'young', 'popular', 'busy'][ctx.i % 5];
      return {
        prompt: `He is ___ ${a} that he can do it well.`,
        choices: shuffle4(['so', 'very', 'too', 'much']),
        answer: 'so',
        explain: 'so + 形容词/副词 + that 引导结果状语从句。',
      };
    },
  },
  {
    tag: 'conjunction',
    rule: 'too…to 句型',
    make: (ctx) => {
      const a = ['young', 'small', 'weak', 'heavy', 'nervous'][ctx.i % 5];
      return {
        prompt: `The box is ___ ${a} for the little boy to carry.`,
        choices: shuffle4(['too', 'so', 'very', 'enough']),
        answer: 'too',
        explain: 'too + 形容词 + to do（太……而不能……）。',
      };
    },
  },
  {
    tag: 'conjunction',
    rule: 'enough to 句型',
    make: (ctx) => {
      const a = ['old', 'strong', 'brave', 'rich', 'careful'][ctx.i % 5];
      return {
        prompt: `He is ___ ${a} enough to take care of himself.`,
        choices: shuffle4(['—', 'too', 'very', 'so']),
        answer: '—',
        explain: '形容词 + enough + to do（足够……能做……）。',
      };
    },
  },
  {
    tag: 'conjunction',
    rule: '并列连词 but 表转折',
    make: () => ({
      prompt: 'The bag is very heavy, ___ nobody wants to carry it.',
      choices: shuffle4(['but', 'so', 'because', 'or']),
      answer: 'but',
      explain: '前后分句是转折关系（重 vs 没人愿意），用 but。',
    }),
  },
  {
    tag: 'conjunction',
    rule: 'because 引导原因',
    make: () => ({
      prompt: 'He was late for school ___ he got up too late.',
      choices: shuffle4(['because', 'so', 'but', 'although']),
      answer: 'because',
      explain: '后面是原因、前面是结果，用 because 引导原因状语从句。',
    }),
  },

  /* ---- 比较级 / 最高级：由标志词唯一决定 ---- */
  {
    tag: 'comparison',
    rule: 'than 后用比较级',
    make: (ctx) => {
      const a = ['interesting', 'important', 'difficult', 'exciting', 'expensive'][ctx.i % 5];
      return {
        prompt: `This story is ___ than that one.`,
        choices: shuffle4([`more ${a}`, a, `most ${a}`, `the ${a}`]),
        answer: `more ${a}`,
        explain: `多音节形容词 ${a} 的比较级是 more ${a}，且句中有 than。`,
      };
    },
  },
  {
    tag: 'comparison',
    rule: 'the … in 用最高级',
    make: (ctx) => {
      const s = ['tall', 'fast', 'old', 'young', 'strong'][ctx.i % 5];
      const sup = s === 'old' ? 'oldest' : s === 'young' ? 'youngest' : `${s}est`;
      const comp = s === 'old' ? 'older' : s === 'young' ? 'younger' : `${s}er`;
      return {
        prompt: `Jack is the ___ boy in his class.`,
        choices: shuffle4([sup, comp, s, `most ${s}`]),
        answer: sup,
        explain: `句中有 the 与范围（in his class），用最高级 ${sup}。`,
      };
    },
  },
  {
    tag: 'comparison',
    rule: 'as…as 原级比较',
    make: (ctx) => {
      // 只取规则变化的短形容词：heavy→heaviest、careful→carefulest 这类
      // 变化不规则，放进选项会同时出现「正确」与「更像正确」的干扰项。
      const forms = [['tall', 'taller', 'tallest'], ['short', 'shorter', 'shortest'],
        ['old', 'older', 'oldest'], ['young', 'younger', 'youngest'], ['fast', 'faster', 'fastest']];
      const [base, comp, sup] = forms[ctx.i % forms.length];
      return {
        // 两个 as 都写在题干里：只留一个 as 的话，"Tom is tall as his father"
        // 既不通顺，选项里也分不出「原级」到底填哪。
        prompt: `Tom is as ___ as his father.`,
        choices: shuffle4([base, comp, sup, `most ${base}`]),
        answer: base,
        explain: `as … as 中间用形容词原级 ${base}。`,
      };
    },
  },

  /* ---- 时态：正确项查动词变位表 ---- */
  {
    tag: 'tense',
    rule: '一般过去时',
    make: (ctx) => {
      const v = ctx.pickVerb(ctx.i, 0);
      return {
        prompt: `Yesterday afternoon he ___ to the library.`,
        choices: shuffle4([v.p, v.b, v.s, `will ${v.b}`]),
        answer: v.p,
        explain: `yesterday afternoon 标志一般过去时，${v.b} 的过去式是 ${v.p}。`,
      };
    },
  },
  {
    tag: 'tense',
    rule: '一般现在时第三人称单数',
    make: (ctx) => {
      const v = ctx.pickVerb(ctx.i, 1);
      return {
        prompt: `My father ___ the newspaper every morning.`,
        choices: shuffle4([v.s, v.b, v.p, `is ${v.ing}`]),
        answer: v.s,
        explain: `every morning + 主语第三人称单数，动词用 ${v.s}。`,
      };
    },
  },
  {
    tag: 'tense',
    rule: '现在进行时',
    make: (ctx) => {
      const v = ctx.pickVerb(ctx.i, 2);
      const be = ['are', 'is', 'are', 'are'][ctx.i % 4];
      const subj = be === 'is' ? 'He' : 'They';
      return {
        prompt: `Look! ${subj} ___ at the moment.`,
        choices: shuffle4([`${be} ${v.ing}`, `${subj === 'He' ? 'has' : 'have'} ${v.p}`, v.s, v.p]),
        answer: `${be} ${v.ing}`,
        explain: `at the moment / Look! 提示现在进行时：${be} + ${v.ing}。`,
      };
    },
  },
  {
    tag: 'tense',
    rule: '一般将来时',
    make: (ctx) => {
      const v = ctx.pickVerb(ctx.i, 3);
      return {
        prompt: `We ___ to Shanghai next weekend.`,
        choices: shuffle4([`will ${v.b}`, v.p, v.b, `was ${v.ing}`]),
        answer: `will ${v.b}`,
        explain: `next weekend 提示一般将来时：will + 动词原形 ${v.b}。`,
      };
    },
  },
  {
    tag: 'tense',
    rule: '一般过去时（yesterday 修饰）',
    make: (ctx) => {
      const v = ctx.pickVerb(ctx.i, 4);
      return {
        prompt: `She ___ a beautiful picture yesterday.`,
        choices: shuffle4([v.p, v.b, v.s, `will ${v.b}`]),
        answer: v.p,
        explain: `yesterday 是过去时标志，动词用过去式 ${v.p}。`,
      };
    },
  },
  {
    tag: 'voice',
    rule: '一般过去时被动语态',
    make: (ctx) => {
      // 主语与动词必须**配对**：随机取动词会出现 "The bridge was eaten last year"
      // 这种语法对、语义荒唐的句子，对初中生是误导。
      const pairs = [
        ['The bridge', 'build'], ['The letter', 'write'], ['The cake', 'make'],
        ['The lesson', 'teach'], ['The bag', 'carry'], ['The room', 'clean'],
        ['The cake', 'sell'], ['English', 'speak'], ['The chair', 'use'],
        ['The story', 'tell'], ['The photo', 'take'], ['The song', 'sing'],
      ];
      const [subj, base] = pairs[ctx.i % pairs.length];
      const v = VERB_FORMS.find((x) => x.b === base);
      return {
        prompt: `${subj} ___ last year.`,
        choices: shuffle4([`was ${v.pp}`, v.s, `was ${v.ing}`, v.p]),
        answer: `was ${v.pp}`,
        explain: `${subj} 是动作的承受者、时间是 last year，用一般过去时被动语态：was + 过去分词 ${v.pp}。`,
      };
    },
  },
  {
    tag: 'voice',
    rule: '一般现在时被动语态',
    make: (ctx) => {
      const pairs = [
        ['English', 'speak'], ['The room', 'clean'], ['Homework', 'do'], ['The story', 'tell'],
        ['Trees', 'plant'], ['The car', 'use'], ['Letters', 'write'], ['Fruit', 'grow'],
        ['The door', 'lock'], ['Music', 'hear'], ['Food', 'serve'], ['The book', 'make'],
      ];
      const [subj, base] = pairs[ctx.i % pairs.length];
      const v = VERB_FORMS.find((x) => x.b === base) || { b: base, s: `${base}s`, p: `${base}ed`, pp: `${base}d` };
      return {
        prompt: `${subj} ___ every day.`,
        choices: shuffle4([`is ${v.pp}`, v.s, `is ${v.ing}`, v.p]),
        answer: `is ${v.pp}`,
        explain: `${subj} 是动作的承受者、every day 表习惯，用一般现在时被动语态：is + 过去分词 ${v.pp}。`,
      };
    },
  },

  /* ---- 非谓语：触发词决定 to do / doing ---- */
  {
    tag: 'nonfinite',
    rule: 'enjoy 后接动名词',
    make: (ctx) => {
      const v = ctx.pickVerb(ctx.i, 7);
      return {
        prompt: `He enjoys ___ very much.`,
        choices: shuffle4([v.ing, v.b, `to ${v.b}`, v.p]),
        answer: v.ing,
        explain: `enjoy 后只能接动名词：enjoy ${v.ing}。`,
      };
    },
  },
  {
    tag: 'nonfinite',
    rule: 'It\'s time to do',
    make: (ctx) => {
      const v = ctx.pickVerb(ctx.i, 8);
      return {
        prompt: `It's time ___ school now.`,
        choices: shuffle4([`to ${v.b}`, v.ing, v.b, `for ${v.ing}`]),
        answer: `to ${v.b}`,
        explain: `It's time to do sth（到做某事的时间了）：to ${v.b}。`,
      };
    },
  },
  {
    tag: 'nonfinite',
    rule: 'ask sb. to do',
    make: (ctx) => {
      const v = ctx.pickVerb(ctx.i, 9);
      return {
        prompt: `My mother asked me ___ my room every day.`,
        choices: shuffle4([`to ${v.b}`, v.ing, v.b, `not ${v.ing}`]),
        answer: `to ${v.b}`,
        explain: `ask sb. to do sth（让某人做某事）：to ${v.b}。`,
      };
    },
  },
  {
    tag: 'nonfinite',
    rule: 'be good at 后接动名词',
    make: (ctx) => {
      const v = ctx.pickVerb(ctx.i, 10);
      return {
        prompt: `My sister is good at ___ the violin.`,
        choices: shuffle4([v.ing, `to ${v.b}`, v.b, v.p]),
        answer: v.ing,
        explain: `介词 at 后接动名词：at ${v.ing}。`,
      };
    },
  },
  {
    tag: 'nonfinite',
    rule: 'look forward to 后接动名词',
    make: (ctx) => {
      const v = ctx.pickVerb(ctx.i, 11);
      return {
        prompt: `I'm looking forward to ___ from you soon.`,
        choices: shuffle4([v.ing, `to ${v.b}`, v.b, `have ${v.p}`]),
        answer: v.ing,
        explain: `look forward to 中的 to 是介词，后接动名词：${v.ing}。`,
      };
    },
  },
  {
    tag: 'nonfinite',
    rule: 'finish 后接动名词',
    make: (ctx) => {
      const v = ctx.pickVerb(ctx.i, 12);
      return {
        prompt: `Please finish ___ your homework before dinner.`,
        choices: shuffle4([v.ing, `to ${v.b}`, v.b, `for ${v.b}`]),
        answer: v.ing,
        explain: `finish 后接动名词：finish ${v.ing}。`,
      };
    },
  },

  /* ---- 情态动词：由语境唯一 ---- */
  {
    tag: 'modal',
    rule: '义务 must',
    make: (ctx) => {
      const act = ['wear a helmet when riding a bike', 'follow the traffic rules', 'be quiet in the library', 'hand in your homework on time'][ctx.i % 4];
      return {
        prompt: `You ___ ${act}.`,
        choices: shuffle4(['must', 'may', 'could', 'needn\'t']),
        answer: 'must',
        explain: '句意为强制性义务，用 must（必须）；may/could 表推测或允许，needn\'t 表不必。',
      };
    },
  },
  {
    tag: 'modal',
    rule: '推测 may',
    make: (ctx) => {
      const act = ['come to the party tonight', 'be at home now', 'call you back later', 'join us tomorrow'][ctx.i % 4];
      return {
        prompt: `He ___ ${act}, but I'm not sure.`,
        choices: shuffle4(['may', 'must', 'should have', 'has to']),
        answer: 'may',
        explain: '后面跟 but I\'m not sure，表示不确定的推测，用 may（可能）。',
      };
    },
  },
  {
    tag: 'modal',
    rule: '否定推测 can\'t',
    make: (ctx) => {
      const rest = [
        'be Jim. He is in Shanghai now',
        'be so heavy. It is made of paper',
        'be true. Nobody saw it happen',
        'be late. The class starts at eight',
      ][ctx.i % 4];
      return {
        prompt: `It ___ ${rest}.`,
        choices: shuffle4(['can\'t', 'mustn\'t', 'may not', 'shouldn\'t']),
        answer: 'can\'t',
        explain: '表示否定推测「不可能」用 can\'t；mustn\'t 表示禁止，不能用于推测。',
      };
    },
  },

  /* ---- there be 就近原则 ---- */
  {
    tag: 'there-be',
    rule: 'there be 就近原则（单数在前）',
    make: (ctx) => {
      const n = ctx.pickN(ctx.i, 13);
      return {
        prompt: `There ___ one ${n} and two pens on the desk.`,
        choices: shuffle4(['is', 'are', 'was', 'have']),
        answer: 'is',
        explain: 'there be 就近原则：离空格最近的是 one（单数），用 is。',
      };
    },
  },
  {
    tag: 'there-be',
    rule: 'there be 就近原则（复数在前）',
    make: (ctx) => {
      const n = ctx.pickN(ctx.i, 14);
      return {
        prompt: `There ___ two pens and one ${n} on the desk.`,
        choices: shuffle4(['are', 'is', 'were', 'have']),
        answer: 'are',
        explain: 'there be 就近原则：离空格最近的是 two（复数），用 are。',
      };
    },
  },

  /* ---- 名词单复数 ---- */
  {
    tag: 'plural',
    rule: '可数名词复数变化',
    make: (ctx) => {
      const forms = [
        ['box', 'boxes'], ['baby', 'babies'], ['leaf', 'leaves'], ['knife', 'knives'],
        ['man', 'men'], ['child', 'children'], ['foot', 'feet'], ['tooth', 'teeth'],
        ['watch', 'watches'], ['dish', 'dishes'], ['city', 'cities'], ['family', 'families'],
        ['wolf', 'wolves'], ['story', 'stories'], ['tooth', 'teeth'], ['piano', 'pianos'],
      ];
      const [base, pl] = forms[ctx.i % forms.length];
      // 规则复数（boy→boys）时 `${base}s` 会和正确项撞车，换成 es/ed 形式做干扰项
      const d1 = `${base}s` === pl ? `${base}es` : `${base}s`;
      const opts = [pl, base, d1, `${base}ing`].filter((x, i, a) => a.indexOf(x) === i);
      while (opts.length < 4) opts.push(`${base}ed`);
      return {
        // 括号里给出原形是各类真题的通行做法：空里要填的**形式**由 three 决定，
        // 但填什么词由括号里的原形决定 —— 去掉括号就成了「不知道填哪个词」。
        prompt: `The boy has three ___ (${base}) in his hand.`,
        choices: shuffle4(opts.slice(0, 4)),
        answer: pl,
        explain: `${base} 的复数形式是 ${pl}（three 提示复数）。`,
      };
    },
  },
  {
    tag: 'plural',
    rule: '不可数名词无复数',
    make: (ctx) => {
      const n = ['information', 'advice', 'news', 'weather'][ctx.i % 4];
      return {
        prompt: `Could you please give me some ___ ?`,
        choices: shuffle4([n, `${n}s`, `a ${n}`, `the ${n}s`]),
        answer: n,
        explain: `${n} 是不可数名词，没有复数形式，some 后直接接原形。`,
      };
    },
  },

  /* ---- 代词（每题只留一个空，避免「两处可选」导致正解不唯一） ---- */
  {
    tag: 'pronoun',
    rule: '名词性物主代词',
    make: (ctx) => {
      const pairs = [['your', 'yours'], ['my', 'mine'], ['her', 'hers'], ['their', 'theirs'], ['our', 'ours']];
      const [adj, mine] = pairs[ctx.i % pairs.length];
      return {
        prompt: `The blue cap on the desk is ___.`,
        choices: shuffle4([mine, adj, `${adj}self`, 'you']),
        answer: mine,
        explain: `is 后面要用名词性物主代词 ${mine}（= ${adj} + 名词），${adj} 是形容词性物主代词，后面必须跟名词。`,
      };
    },
  },
  {
    tag: 'pronoun',
    rule: '主格代词作主语',
    make: (ctx) => {
      const rows = [
        ['She', 'is my new classmate', ['Her', 'Hers', 'Am']],
        ['He', 'is good at math', ['His', 'Him', 'Are']],
        ['They', 'are in the same class', ['Them', 'Theirs', 'Is']],
        ['I', 'am from Nanjing', ['Me', 'Mine', 'Is']],
      ];
      const [subj, rest, distract] = rows[ctx.i % rows.length];
      return {
        prompt: `___ ${rest}.`,
        choices: shuffle4([subj, ...distract]),
        answer: subj,
        explain: `空格作句子的主语，用主格代词 ${subj}；宾格与物主代词不能作主语。`,
      };
    },
  },
  {
    tag: 'pronoun',
    rule: '不定代词作主语视为单数',
    make: (ctx) => {
      const rows = [
        ['Everyone', 'is in the classroom at the moment', ['is', 'are', 'be', 'have']],
        ['Nobody', 'was in the room yesterday', ['was', 'were', 'is', 'are']],
        ['Each of them', 'has a new bike', ['has', 'have', 'is', 'are']],
        ['Something', 'is wrong with the computer', ['is', 'are', 'has', 'have']],
      ];
      const [subj, rest, opts] = rows[ctx.i % rows.length];
      return {
        prompt: `${subj} ___ ${rest}.`,
        choices: shuffle4(opts),
        answer: opts[0],
        explain: `${subj} 是不定代词，作主语时谓语动词按单数处理（${opts[0]}）。`,
      };
    },
  },

  /* ---- 疑问词：由答句唯一决定 ---- */
  {
    tag: 'question-word',
    rule: '问时间用 When',
    make: (ctx) => {
      const a = ['It\'s May 1st.', 'It\'s Monday.', 'It\'s my birthday.', 'It\'s next week.'][ctx.i % 4];
      return {
        prompt: `— ___ is your school sports meeting? — ${a}`,
        choices: shuffle4(['When', 'What', 'Where', 'Who']),
        answer: 'When',
        explain: `答句回答的是时间（${a}），问时间用 When。`,
      };
    },
  },
  {
    tag: 'question-word',
    rule: '问方式用 How',
    make: (ctx) => {
      const a = ['By underground.', 'On foot.', 'By bus.', 'By bike.'][ctx.i % 4];
      return {
        prompt: `— ___ do you go to school every day? — ${a}`,
        choices: shuffle4(['How', 'What', 'When', 'Why']),
        answer: 'How',
        explain: `答句回答出行方式（${a}），问方式用 How。`,
      };
    },
  },
  {
    tag: 'question-word',
    rule: '问地点用 Where',
    make: (ctx) => {
      const a = ['It\'s next to the bank.', 'It\'s on the second floor.', 'It\'s behind the park.', 'It\'s at the end of the street.'][ctx.i % 4];
      return {
        prompt: `— ___ is the nearest hospital? — ${a}`,
        choices: shuffle4(['Where', 'When', 'Who', 'How']),
        answer: 'Where',
        explain: `答句回答位置（${a}），问地点用 Where。`,
      };
    },
  },
  {
    tag: 'question-word',
    rule: '问人用 Who',
    make: (ctx) => {
      const a = ['He\'s my uncle.', 'She\'s my English teacher.', 'They\'s my classmates.', 'It\'s my little brother.'][ctx.i % 4];
      return {
        prompt: `— ___ is that man in a blue coat? — ${a}`,
        choices: shuffle4(['Who', 'What', 'Where', 'Whose']),
        answer: 'Who',
        explain: `答句回答人物（${a}），问人用 Who。`,
      };
    },
  },
  {
    tag: 'question-word',
    rule: '问所属用 Whose',
    make: (ctx) => {
      const a = ['It\'s mine.', 'It\'s Tom\'s.', 'It\'s hers.', 'It\'s our head teacher\'s.'][ctx.i % 4];
      return {
        prompt: `— ___ bike is this? — ${a}`,
        choices: shuffle4(['Whose', 'Who', 'Which', 'What']),
        answer: 'Whose',
        explain: `答句回答归属（${a}），问所属用 Whose。`,
      };
    },
  },

  /* ---- 感叹句 / 反意疑问 / 祈使（结构唯一） ---- */
  {
    tag: 'exclamation',
    rule: 'What 引导的感叹句',
    make: (ctx) => {
      const a = ['beautiful flower', 'interesting book', 'delicious cake', 'heavy box'][ctx.i % 4];
      const s = { 'beautiful flower': 'a beautiful flower', 'interesting book': 'an interesting book', 'delicious cake': 'a delicious cake', 'heavy box': 'a heavy box' }[a];
      return {
        prompt: `___ ${s} it is!`,
        choices: shuffle4(['What', 'How', 'What a', 'How a']),
        answer: 'What',
        explain: '中心词是名词（' + s + '），用 What 引导感叹句：What + (a/an) + 形 + 名 + 主 + 谓！',
      };
    },
  },
  {
    tag: 'exclamation',
    rule: 'How 引导的感叹句',
    make: (ctx) => {
      const a = ['beautiful the flower is', 'hard the work is', 'fast the car runs', 'careful she is'][ctx.i % 4];
      return {
        prompt: `___ ${a}!`,
        choices: shuffle4(['How', 'What', 'How a', 'What a']),
        answer: 'How',
        explain: '中心词是形容词/副词，用 How 引导：How + 形/副 + 主 + 谓！',
      };
    },
  },
  {
    tag: 'imperative',
    rule: '祈使句的否定',
    make: (ctx) => {
      const vp = ['be late for school again', 'shout in the reading room', 'play on the street', 'copy others\' homework'][ctx.i % 4];
      const answer = `Don't ${vp}`;
      return {
        // 题干给的是动词短语，四个选项都套在它前面 —— 这样「No be/Not be」
        // 一眼就能排除。刻意不写 `___ noise…`：告示牌上的 "No noise" 是合法英文，
        // 那样会多出一个可选项，正解就不唯一了。
        prompt: `___ ${vp}. (不要)`,
        choices: shuffle4([answer, `Not ${vp}`, `No ${vp}`, `Doesn't ${vp}`]),
        answer,
        explain: '祈使句的否定在句首加 Don\'t + 动词原形；No 后面只能接名词或 -ing 形式。',
      };
    },
  },
  {
    tag: 'tag-question',
    rule: '反意疑问句（前肯后否）',
    make: () => ({
      prompt: 'You have been to Beijing before, ___ ?',
      choices: shuffle4(['haven\'t you', 'didn\'t you', 'aren\'t you', 'don\'t you']),
      answer: 'haven\'t you',
      explain: '前半句 have been（现在完成时、肯定），后半句用 haven\'t + 主语。',
    }),
  },
];

/**
 * 确定性洗牌（Fisher–Yates，固定 rng）：
 * 只为了让「正确项」不总在 A 位，不影响题意。
 */
function shuffle4(arr, rand) {
  const a = arr.slice();
  const r = rand || (() => 0.5);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export { shuffle4 };

/* =========================== 3. 完形填空骨架 =========================== */

/**
 * 标记约定：`{N1}` `{N2}` 名词、`{A1}` 形容词、`{V1}` 动词原形、`{R1}` 副词、
 * `{T1}` 时间（**不是空**，只做事实填充）、`{NAME}` `{PLACE}` 人名地名（同上）。
 *
 * 骨架只负责句子结构与空位，**具体词由 builder 按变体号取**，
 * 因此同一个骨架换一批词就是一篇新短文 —— 变体之间题干不同，可去重后各自成立。
 *
 * 每篇必须恰好 10 个空（中考完形 10 空是通行规格，也是模拟卷组卷的前提）。
 */
export const CLOZE_SKELETONS = [
  {
    id: 'cloze-weekend',
    theme: '周末出行',
    sents: [
      'Last {T1}, {NAME} went to the {PLACE1} with {HISHER} family.',
      'The weather was {A1@weather}, so they decided to stay outside for a long time.',
      'On the way, they saw a small {N1@road} near the road.',
      'His father took out the {N2@gift} and gave it to a child who was crying.',
      'Then they had a {A3@picnic} picnic on the grass.',
      '{NAME} helped {HISHER} mother put the food on the {N3@flat}.',
      'They ate some {N4@food} and drank a bottle of milk.',
      'After lunch, the children {V1@playPast} happily under the tree.',
      'It was {A2@outing} but nobody wanted to go home.',
      'They left the {PLACE1} at five and wanted to {V2@goish} back home together.',
    ],
  },
  {
    id: 'cloze-school',
    theme: '校园生活',
    sents: [
      'Our school has a new {N1@fac} and it is {A1@room}.',
      'The {N1@fac} opens at eight every morning.',
      'Students can {V1@play} there after class.',
      '{NAME}, one of {HISHER} classmates, works there every {T1}.',
      'He keeps the {N2@fac} clean and puts the {N3@schoolObj} in the right place.',
      'The {N4@fac} is {A2@room}, so we can read without noise.',
      'Last {T1} we had a meeting with our head teacher.',
      'Our teacher asked us to {V2@play} together in the {PLACE1}.',
      'Everyone said it was a {A3@outing} day.',
      'Everyone loved the new room very much.',
    ],
  },
  {
    id: 'cloze-hobby',
    theme: '兴趣爱好',
    sents: [
      '{NAME} has a lot of hobbies and {HE} likes the {N1@hobby} best.',
      '{HE} often {V1@play} after school with {HISHER} friends.',
      'Last {T1} {HE} joined a small match in the {PLACE1}.',
      '{HISHER} {N2@adult} was with {HIM} and gave {HIM} a blue {N3@colour}.',
      'At first {HE} felt {A1@feel} because {HE} could not see well.',
      '{HE} {V2@playPast} quietly and tried again.',
      'In the end {HE} {V3@winPast} the first prize.',
      'How {A2@glad} {HE} was!',
      'On the way home {HE} talked about the {N4@hobby} and laughed all the way.',
      '{NAME} decided to practise every day from then on.',
    ],
  },
  {
    id: 'cloze-help',
    theme: '助人为乐',
    sents: [
      'One {T1} morning, an old woman was standing at the {PLACE1}.',
      'She looked {A1@feel} because she could not find her way.',
      '{NAME} walked to her and asked what was wrong.',
      'She said her {N1@home} was far away and the {N2@heavyObj} was heavy.',
      '{HE} took the {N2@heavyObj} and {V1@goPast} with her to the bus stop.',
      'A kind driver gave her {HISHER} {N3@heavyObj}.',
      'The old woman {V2@sayPast} {HIM} with a smile.',
      'Though {HE} was {A2@tired}, {HE} felt warm in {HISHER} heart.',
      '{HE} {V3@goPast} to school without breakfast.',
      'That day {HE} was late, but everyone understood and the teacher was {A3@kind} with {HIM}.',
    ],
  },
  {
    id: 'cloze-green',
    theme: '环保行动',
    sents: [
      'Our class started a small project to make the {PLACE1} {A1@green}.',
      'On {T1} morning, the students picked up the {N1@litter} on the ground.',
      'Some collected {N2@litter} and put them into different boxes.',
      'Others planted young {N3@plantN} along the wall.',
      '{NAME} and {HISHER} friends {V1@tendPast} the flowers with water.',
      'After two hours the {PLACE1} looked {A2@green} after the cleaning.',
      'A passer-by said our work was {A3@kind}.',
      'We also made a small sign asking people not to {V2@harm} the trees.',
      'Everyone was tired but happy.',
      'We learned that small {N4@act} can make a big difference.',
    ],
  },
  {
    id: 'cloze-trip',
    theme: '旅行见闻',
    sents: [
      'Last summer, {NAME} took a trip to a small {N1@place} near the sea.',
      '{HE} stayed there for {NUM1} days with a friendly family.',
      'Every morning {HE} {V1@playPast} along the beach.',
      'The sea was {A1@sea} and the sky was clean.',
      '{HE} took many photos of the {N2@scene} and the old {N3@scene}.',
      'One {T1} {HE} met a boy who could draw very well.',
      'The boy gave {HIM} a picture as a {N4@gift}.',
      'On the last day the weather turned {A2@weather}.',
      'They {V2@departPast} the village before the rain came.',
      'It was a simple but {A3@outing} journey.',
    ],
  },
];

/* =========================== 4. 阅读理解骨架 =========================== */

/**
 * 阅读题的正解**必须能在短文里直接找到**：
 *   · 3 道细节题由 `facts` 声明的事实生成（时间/地点/人物/数量），
 *     正解是填进短文的那个值，干扰项取自同一类别的**其它**池值 —— 看文即知错；
 *   · 1 道主旨题正解是本骨架的 `mainIdea`，干扰项取其它骨架的主旨；
 *   · 1 道词义猜测题正解是文中原词的中文释义，干扰项是同篇其它词的释义。
 */
export const READING_SKELETONS = [
  {
    id: 'read-market',
    mainIdea: '一次周末购物经历',
    sents: [
      'Last {T1}, {NAME} went to the {PLACE1} with {HISHER} mother.',
      'They wanted to buy a {N1@gift} for {HISHER} father\'s birthday.',
      'First they looked at the {N2@colour} near the door.',
      'Then a shopkeeper showed them a blue {N3@colour} and a red {N4@colour}.',
      '{NAME} liked the blue one because it was {A1@itemAdj}.',
      '{HISHER} mother paid {NUM1} yuan for it.',
      'On the way home they also bought some {N5@food}.',
      '{NAME} was tired but very {A2@glad}.',
    ],
    facts: ['when', 'where', 'howMany'],
  },
  {
    id: 'read-school-day',
    mainIdea: '充实的一天校园生活',
    sents: [
      '{NAME} gets up at six and goes to school every {T1}.',
      'The first class is {N1@subject}, and the teacher writes on the blackboard.',
      'At ten the students do exercises on the {PLACE1@sportPlace}.',
      'There are {NUM1} students in {HISHER} class.',
      'In the afternoon the students study {N2@subject} together.',
      'Every afternoon {NAME} and {HISHER} classmates {V1@play} together.',
      '{HE} goes home when the {N3@light} turns on.',
      'Every day feels {A1@outing} but happy.',
    ],
    facts: ['when', 'howMany', 'where'],
  },
  {
    id: 'read-visit',
    mainIdea: '一次难忘的参观',
    sents: [
      'On {T1}, the students of Class Two visited the {PLACE1}.',
      'The {PLACE1} is {NUM1} kilometres from their school.',
      'A kind guide named {NAME} showed them around.',
      'They saw an old {N1@scene} and a beautiful {N2@scene}.',
      'Some students took photos of the {N3@scene}.',
      'The guide told them a funny story and everyone {V1@laughPast}.',
      'They left the {PLACE1} at four in the afternoon.',
      'It was a {A1@outing} trip and they learned a lot.',
    ],
    facts: ['when', 'howMany', 'where'],
  },
  {
    id: 'read-lost-dog',
    mainIdea: '邻里之间互相帮助',
    sents: [
      'One {T1}, {NAME} found a small dog at the {PLACE1}.',
      'The dog looked {A1@feel} and hungry.',
      'It wore a blue {N1@colour}.',
      '{NAME} took the dog home and gave it some {N2@food}.',
      '{HE} made a short message and put it on the {N3@road}.',
      'The next day {NUM1} neighbours came to see {HIM}.',
      'One of them was the owner, who lived near the {PLACE1}.',
      'The owner was {A2@glad} to see {HISHER} dog again.',
    ],
    facts: ['when', 'where', 'howMany'],
  },
  {
    id: 'read-green-school',
    mainIdea: '学校里的环保小行动',
    sents: [
      'This term our school began a green project on {T1}.',
      'Students put {NUM1} boxes in the {PLACE1}.',
      'They collected waste {N1@litter} and old {N2@litter} every week.',
      '{NAME} made a poster and drew a big {N3@scene} on it.',
      'The poster asked everyone to keep the {PLACE1} clean.',
      'After two months the school looked {A1@green}.',
      'Our head teacher said the idea was {A2@kind}.',
      'Now more and more students {V1@support} the project.',
    ],
    facts: ['when', 'howMany', 'where'],
  },
  {
    id: 'read-busy-sunday',
    mainIdea: '忙碌而温暖的周日',
    sents: [
      '{NAME} had a busy {T1}.',
      'In the morning {HE} helped {HISHER} mother clean the {N1@flat}.',
      'Then {HE} rode {HISHER} {N2@vehicle} to the {PLACE1}.',
      '{HE} met {HISHER} best friend {NAME2} there.',
      'They played for {NUM1} hours and then had lunch.',
      'In the afternoon {HE} finished {HISHER} {N3@homework} at home.',
      '{HISHER} father read a {N4@bookish} and {HISHER} sister drew a picture.',
      'It was a simple but {A1@outing} day.',
    ],
    facts: ['when', 'howMany', 'where'],
  },
  {
    id: 'read-sports-day',
    mainIdea: '一次紧张的运动会',
    sents: [
      'Our sports day fell on {T1} this year.',
      '{NAME} ran in the {NUM1}-hundred-metre race.',
      'The {PLACE1} was full of students and teachers.',
      '{HE} was {A1@feel} before the race, but {HISHER} classmates shouted loudly.',
      '{HE} ran fast and finished second in the race.',
      'Our class won a blue {N1@colour} in the end.',
      'Everyone took a photo near the {N2@scene}.',
      'It was an {A2@outing} afternoon.',
    ],
    facts: ['when', 'howMany', 'where'],
  },
  {
    id: 'read-library',
    mainIdea: '图书馆里的安静时光',
    sents: [
      'Every {T1} {NAME} goes to the {PLACE1} after school.',
      'The {PLACE1} is open until eight in the evening.',
      '{HE} likes the {N1@flat} near the window because it is {A1@room}.',
      'There are thousands of {N2@bookish} about science and history.',
      '{HE} borrowed {NUM1} books last week.',
      '{HISHER} teacher {NAME2} advised {HIM} to read a {N3@bookish}.',
      'In the room {HE} does not {V1@talkV} at all.',
      'The place makes {HIM} feel {A2@glad}.',
    ],
    facts: ['when', 'howMany', 'where'],
  },
  {
    id: 'read-rainy-day',
    mainIdea: '雨天里的意外温暖',
    sents: [
      'It began to rain heavily on {T1}.',
      '{NAME} had no {N1@rainGear} with {HIM}.',
      '{HE} stood at the {PLACE1} and waited for the rain to stop.',
      'A woman {HE} did not know shared {HISHER} {N2@rainGear} with {HIM}.',
      'They walked for {NUM1} minutes and then said goodbye.',
      'She lived near the {PLACE1} and worked in a {N3@work}.',
      '{HE} never saw her again, but {HE} still {V1@rememberPast} her.',
      'That {T1} taught {HIM} to be {A1@moral}.',
    ],
    facts: ['when', 'howMany', 'where'],
  },
  {
    id: 'read-farm-visit',
    mainIdea: '农场里的一次劳动课',
    sents: [
      'Last {T1}, the students went to a small {N1@place} near the {PLACE1}.',
      'The farmer showed them a small {N2@farmAnimal} and some {N3@crop}.',
      'There were {NUM1} cows and many chickens on the farm.',
      '{NAME} picked {N4@crop} with {HISHER} friends.',
      'They also fed the animals and cleaned the {N5@yard}.',
      'Everyone was {A1@tired} but nobody complained.',
      'On the way back they talked about the {N6@memory}.',
      'It was a useful and {A2@outing} lesson.',
    ],
    facts: ['when', 'howMany', 'where'],
  },
  {
    id: 'read-new-neighbour',
    mainIdea: '新邻居带来的变化',
    sents: [
      'A new family moved into the {N1} next door on {T1}.',
      'Their son is of the same age as {NAME}.',
      'The son is {A1@neighbour} and always ready to help.',
      'On the first day he carried {NUM1} heavy boxes for {NAME}.',
      'The two boys walked to the {PLACE1} together.',
      'They found they both like the same {N3@hobby}.',
      'Now they {V1@play} every afternoon.',
      'Everyone in the building says they are a good {N4}.',
    ],
    facts: ['when', 'where', 'howMany'],
  },
  {
    id: 'read-cleaning-day',
    mainIdea: '班级大扫除的成果',
    sents: [
      'Our class had a cleaning day on {T1}.',
      'Students swept the floor and washed the {N1@cleanObj}.',
      '{NAME} cleaned the {N2@cleanObj} in the {PLACE1} with a piece of cloth.',
      'Others moved the heavy {N3@heavyObj} out of the room.',
      'We finished the work in {NUM1} hours.',
      'The room became {A1@green} and brighter than before.',
      'Our teacher brought some {N4@food} for everyone.',
      'We all agreed it was a {A2@outing} day.',
    ],
    facts: ['when', 'howMany', 'where'],
  },
];

/* =========================== 5. 选词填空骨架 =========================== */

/**
 * 选词填空与完形的区别：**所有空共用同一份词库**（10 词，5 正 5 干扰），
 * 每道题的 options 都是整份词库 —— 这正是「选词」题的形态。
 * 每篇恰好 5 空（模拟卷里选词占 5 题）。
 */
export const BANKFILL_SKELETONS = [
  {
    id: 'bank-morning',
    sents: [
      '{NAME} has a good morning habit.',
      '{HE} gets up {R1@morning} and never {V1} late for school.',
      '{HE} {R2@freq} eats breakfast with {HISHER} family.',
      'Then {HE} leaves home and walks {R3@leisure} to the bus stop.',
      '{HISHER} mother says a {A1@glad} start makes a good day.',
    ],
  },
  {
    id: 'bank-reading',
    sents: [
      'Reading is a {A1@habit} habit for students.',
      'A good book can {V1} us to think in a new way.',
      'We should read {R1@study} and take notes.',
      'Last month our class {R2@freq} finished a report.',
      'The library is the {A2@placeAdj} place for reading.',
    ],
  },
  {
    id: 'bank-friend',
    sents: [
      'A true friend is {A1@glad} in time of trouble.',
      'A true friend will {V1@help} you when you need help.',
      'Friends should talk {R1@talk} and listen carefully.',
      '{NAME} and {HISHER} friends {R2@freq} go to the park together.',
      'Their {N1@team} has lasted for many years.',
    ],
  },
  {
    id: 'bank-health',
    sents: [
      'To keep {A1@fit}, we need enough sleep and exercise.',
      'You had better {V1@eat} more vegetables every day.',
      'Running {R1@leisure} in the morning is good for us.',
      'Our teacher {R2@freq} tells us not to stay up late.',
      'Good living {N1@method} help us stay strong.',
    ],
  },
  {
    id: 'bank-travel',
    sents: [
      'Travelling can make a person {A1@makeFeel}.',
      'Last summer we {V1@goPast} to a small town by train.',
      'The town is {R1@known} for its old bridge.',
      'We walked {R2@leisure} around the old street.',
      'The trip gave us many happy {N1@memory}.',
    ],
  },
  {
    id: 'bank-study',
    sents: [
      'Good learners are {A1@curious} about new ideas.',
      'They always {V1@note} their notes after class.',
      'We should review the lessons {R1@study} every week.',
      'Our monitor {R2@freq} finishes homework first.',
      'A good {N1@method} method saves a lot of time.',
    ],
  },
  {
    id: 'bank-family',
    sents: [
      'A warm family makes children feel {A1@makeFeel}.',
      'On Sundays {NAME} and {HISHER} family {V1@play} together at home.',
      'My grandmother {R1@freq} tells us old stories.',
      'We eat dinner {R2@leisure} and talk about our week.',
      'Family {N1@memory} are the sweetest memories.',
    ],
  },
  {
    id: 'bank-holiday',
    sents: [
      'The winter holiday was long and {A1@outing}.',
      'We {V1@goPast} to the countryside to see our grandparents.',
      'The air there is {A2@fresh} and clean.',
      'We played {R1@leisure} in the fields every afternoon.',
      'It was a holiday full of {N1@memory}.',
    ],
  },
  {
    id: 'bank-teamwork',
    sents: [
      'Teamwork makes a task {A1@easy} to finish.',
      'In a team everyone should {V1@do} his own work.',
      'Members talk {R1@talk} before they start.',
      '{NAME}\'s group {R2@won} won the game last term.',
      'Success needs good {N1@team} among members.',
    ],
  },
  {
    id: 'bank-dream',
    sents: [
      'A young man with a big dream is {A1@brave}.',
      'He may {V1@fail} many times before he succeeds.',
      'We should {R1@freq} hold on even when it is difficult.',
      'His story {R2@really} moved all of us.',
      'He believes that there will be a {N1@chance} for him.',
    ],
  },
];

/* =========================== 6. 书面表达任务 =========================== */

/**
 * 中考书面表达的常见任务形态：应用文（信/通知/日记/邀请）+ 话题作文。
 * `min/max` 按中考 60–100 词的常见要求；`checklist` 是给自评用的要点。
 */
export const WRITING_TASKS = [
  { genre: '邀请信', prompt: '你叫李华，外教 Mr. Green 对中国文化很感兴趣。请给他写一封邮件，邀请他参加学校本周五的中国书法体验课。', min: 60, max: 100 },
  { genre: '邀请信', prompt: '你的英国朋友 Tom 想来你的城市游玩。请写一封邮件，邀请他来，并介绍你计划带他去的一个地方。', min: 60, max: 100 },
  { genre: '求助信', prompt: '你打算参加学校的英语演讲比赛，但不知如何准备。请给外教写一封邮件，说明你的困难并请求建议。', min: 60, max: 100 },
  { genre: '求助信', prompt: '你的好朋友最近学习压力很大。请写一封邮件，给出至少两条具体的建议。', min: 60, max: 100 },
  { genre: '感谢信', prompt: '上周你生病在家，同学帮你补了笔记。请写一封邮件表示感谢，并说明这些笔记对你的帮助。', min: 60, max: 100 },
  { genre: '感谢信', prompt: '你在国外旅行时得到了一位陌生人的帮助。请写一封邮件感谢他/她。', min: 60, max: 100 },
  { genre: '通知', prompt: '你校将举办英语角活动。请以学生会的名义写一则英文通知，说明时间、地点和活动内容。', min: 60, max: 100 },
  { genre: '通知', prompt: '学校图书馆本周六闭馆整理图书。请写一则英文通知告知同学。', min: 60, max: 100 },
  { genre: '日记', prompt: '请用英语写一篇日记，记录你上周日帮助父母做家务的一天。', min: 60, max: 100 },
  { genre: '日记', prompt: '请用英语写一篇日记，记录你第一次做饭的经历与感受。', min: 60, max: 100 },
  { genre: '介绍信', prompt: '新来的外教想了解你的学校生活。请写一封邮件，介绍你的学校、老师和课余活动。', min: 60, max: 100 },
  { genre: '介绍信', prompt: '请给你的笔友写一封邮件，介绍你的家庭成员与日常生活。', min: 60, max: 100 },
  { genre: '话题作文', prompt: '以 My Favourite Festival 为题，写一篇短文，介绍你最喜欢的节日及原因。', min: 60, max: 100 },
  { genre: '话题作文', prompt: '以 The Way to School 为题，介绍你上学的方式与路上的见闻。', min: 60, max: 100 },
  { genre: '话题作文', prompt: '以 A Helpful Person 为题，写一位曾经帮助过你的人。', min: 60, max: 100 },
  { genre: '话题作文', prompt: '以 How to Keep Healthy 为题，写出你保持健康的方法。', min: 60, max: 100 },
  { genre: '话题作文', prompt: '以 My Dream 为题，谈谈你未来的职业梦想与打算。', min: 60, max: 100 },
  { genre: '话题作文', prompt: '以 Saving Water 为题，谈谈节约用水的重要性与做法。', min: 60, max: 100 },
  { genre: '看图作文', prompt: '根据提示写一篇短文：图片中几个学生正在公园捡垃圾。请描述图片内容并谈谈你的看法。', min: 60, max: 100 },
  { genre: '看图作文', prompt: '根据提示写一篇短文：图片中一个小男孩在雨天为老奶奶撑伞。请描述图片内容并说明你的感受。', min: 60, max: 100 },
  { genre: '应用文', prompt: '你校英语社团要招募新成员。请写一则英文自我介绍，说明你的兴趣与优势。', min: 60, max: 100 },
  { genre: '应用文', prompt: '请写一则英文海报文案，介绍你们班将要举办的一次义卖活动。', min: 60, max: 100 },
  { genre: '发言稿', prompt: '你将在升旗仪式上发言。请写一篇英文发言稿，主题是 Do the Small Things Well。', min: 60, max: 100 },
  { genre: '发言稿', prompt: '请写一篇英文发言稿，在班会上介绍你读过的一本好书。', min: 60, max: 100 },
  { genre: '邮件', prompt: '你的外国朋友想了解你的周末安排。请写一封邮件，介绍你本周六和周日的计划。', min: 60, max: 100 },
  { genre: '邮件', prompt: '你收到了学校交换项目的宣传单。请写一封邮件，向老师询问项目的时间、费用与报名方式。', min: 60, max: 100 },
  { genre: '建议信', prompt: '你校操场周末向公众开放，但出现了一些问题。请写一封信，向校长提出两条改进建议。', min: 60, max: 100 },
  { genre: '话题作文', prompt: '以 Reading Is a Good Habit 为题，谈谈阅读的好处以及你自己的阅读习惯。', min: 60, max: 100 },
  { genre: '话题作文', prompt: '以 The Importance of Time 为题，谈谈珍惜时间的理由与做法。', min: 60, max: 100 },
  { genre: '话题作文', prompt: '以 My Hobby 为题，介绍你的一个爱好、坚持的时间以及它带给你的收获。', min: 60, max: 100 },
];

/* =========================== 7. 高中（高考）素材 =========================== */

/** 高中完形/阅读的补充池（复用初中已有的 weather/outing/feel/… 之外的场景词） */
export const SENIOR_SLOTS = {
  inst: ['violin', 'piano', 'guitar', 'drum'],
  learnPast: ['learned', 'seen', 'done', 'got', 'heard'],
  town: ['town', 'village', 'city', 'street', 'market'],
  tech: ['phone', 'computer', 'camera', 'machine', 'robot'],
  news: ['newspaper', 'report', 'magazine', 'article', 'letter'],
  interview: ['question', 'answer', 'story', 'idea', 'plan'],
  craft: ['tool', 'brush', 'knife', 'thread', 'wood'],
  newsPast: ['reported', 'answered', 'wrote', 'took', 'made'],
  busy: ['busy', 'fast', 'hard', 'difficult', 'popular'],
};

/**
 * 高中完形：与初中同一套 10 空机制，题材换成更「高中生」的场景。
 * 每篇恰好 10 个可空键（模拟卷按整篇取用，2 篇 = 20 空）。
 * 注意叙述时态：过去时叙事里动词一律用 xxxPast 池，`to ___` 之后用原形池。
 */
export const SENIOR_CLOZE_SKELETONS = [
  {
    id: 'sencloze-volunteer',
    theme: '志愿服务',
    sents: [
      'Last {T1}, a group of students went to a nursing home near the {PLACE1}.',
      '{NAME} and {HISHER} classmates {V1@playPast} there by bus and brought some {N2@gift}.',
      'The old people were {A1@glad} to see them.',
      'One student {V2@sayPast} a poem, and another played the {N3@inst}.',
      'They also helped the workers clean the {N1@flat} and wash the windows.',
      'Before leaving, they gave each old person a hand-made {N4@gift}.',
      'Everyone agreed it was a wonderful day.',
      'On the way back they talked about what they had {V3@learnPast}.',
      'They decided to {V4@goish} there again next month.',
      'The head teacher was proud of what they did.',
    ],
  },
  {
    id: 'sencloze-craft',
    theme: '传统手艺',
    sents: [
      'On {T1} afternoon our class visited a small workshop in the {PLACE1}.',
      'An old craftsman showed the students how to use a {N1@craft}.',
      'He said the skill took him {NUM1} years to learn.',
      'The students watched {A1@feel} because they had never seen it before.',
      'Then each of them {V1@sayPast} a question about the working process.',
      'The craftsman {V2@sayPast} them that patience was the most important {N2@craft}.',
      'He let the students try with a {N3@craft} in their own hands.',
      'Some of the works looked {A2@room} in the end.',
      'The visit taught us to {V3@goish} the old art.',
      'The class decided to {V4@play} a part in protecting the art.',
    ],
  },
  {
    id: 'sencloze-interview',
    theme: '校园采访',
    sents: [
      'Last {T1}, the school newspaper interviewed a famous reporter in the {PLACE1}.',
      '{HE} answered every {N1@interview} patiently.',
      'He said he read {N2@news} every {T2}.',
      'Reading made him think {R1@leisure} and write better.',
      'When asked about his success, he {V1@sayPast} it was all about hard work.',
      'The whole team {V2@newsPast} the story the next day.',
      'It became one of the most popular {N3@news} in our school.',
      'Students still {V3@sayPast} about it weeks later.',
      'We learned that a good {N4@interview} needs both skill and respect.',
      'The experience changed how we look at news.',
    ],
  },
  {
    id: 'sencloze-green',
    theme: '环保科技',
    sents: [
      'Our city has built a new {N2@tech} to keep the {PLACE1} clean.',
      'The {N1@tech} can sort waste automatically every day.',
      'It works {R1@leisure} and never breaks down.',
      'Last year the city {V1@sayPast} the plan in several schools.',
      'Students were asked to {V2@goish} plastic bottles to special bins.',
      'The result was {A1@green} than anyone had expected.',
      'Roughly {NUM1} kilograms of {N4@litter} were saved each week.',
      'Experts call it a {A2@outing} example for other cities.',
      'People believe the idea will {V3@play} an important part in the future.',
      'It shows that small {N3@act} can change a city.',
    ],
  },
];

/**
 * 高中阅读：每篇 4 题 = 细节 2 + 主旨 1 + 词义 1（高考阅读每题 2 分的常见形态）。
 * 正解机制与初中一致：细节答案来自短文事实、主旨来自本篇、词义来自文中词的释义。
 */
export const SENIOR_READING_SKELETONS = [
  {
    id: 'senread-teaching',
    mainIdea: '一次难忘的支教经历',
    howManyQ: 'According to the passage, how many students went to the village? ___',
    sents: [
      'Last {T1}, {NAME} and {NUM1} other students went to teach in a small {N1@place}.',
      'The village lay {NUM2} kilometres from the nearest town.',
      'Classes there were held in a {N2} without modern equipment.',
      '{HE} taught the children {N3@subject} and told them stories about the {PLACE1}.',
      'After class the children {V1@playPast} with {HIM} on the hill.',
      '{HE} gave each child a {N4@gift} before leaving.',
      'On the last day the whole village came to say goodbye.',
      '{HE} promised to {V2@goish} back the next summer.',
    ],
    facts: ['when', 'howMany'],
  },
  {
    id: 'senread-city',
    mainIdea: '城市与乡村生活方式的对比',
    howManyQ: 'According to the passage, how many years did the man work in the city? ___',
    sents: [
      'For about {NUM1} years {NAME} worked in a big city near the {PLACE1}.',
      'Life there was {A1@busy} but never boring.',
      'Every morning {HE} {V1@goish} to the office by subway.',
      '{HE} liked the city because of its {N1@tech} and convenient services.',
      'However, {HE} missed the quiet {N2@town} where he grew up.',
      'So every {T1} {HE} returned to visit {HISHER} parents.',
      'The village now has {NUM2} new houses and a small library.',
      'People say the two places are becoming more and more alike.',
    ],
    facts: ['howMany', 'where'],
  },
  {
    id: 'senread-habit',
    mainIdea: '一项关于阅读习惯的调查',
    howManyQ: 'According to the passage, how many students were surveyed? ___',
    sents: [
      'A recent survey shows that {NUM1} students in our city were asked about reading.',
      'About half of them read {N1@news} every week.',
      'Students who read more often usually feel {A1@busy} about their study.',
      'The library near the {PLACE1} stays open until nine in the evening.',
      'On {T1} the library held a reading corner where many book lovers met.',
      'They exchanged ideas about their favourite {N2@bookish}.',
      'Experts believe the habit helps young people think {R1@leisure}.',
      'The survey report {V1@newsPast} at the end of last month.',
    ],
    facts: ['howMany', 'where'],
  },
  {
    id: 'senread-craftsman',
    mainIdea: '一位工匠的坚持',
    howManyQ: 'According to the passage, how many years has he made umbrellas? ___',
    sents: [
      '{NAME} has made umbrellas by hand for {NUM1} years.',
      'His small shop stands at the end of a narrow {N1@town}.',
      'Each umbrella needs about {NUM2} steps before it is ready.',
      'He works carefully and never {V1@sayPast} when a piece is wrong.',
      'Young people rarely choose this {A1@outing} job today.',
      'Still, {HE} believes the skill should not disappear in history.',
      'Last {T1} a museum invited {HIM} to show his {N2@craft} to visitors.',
      'Many visitors called the work a piece of living history.',
    ],
    facts: ['when', 'howMany'],
  },
  {
    id: 'senread-space',
    mainIdea: '航天科普走进校园',
    howManyQ: 'According to the passage, how many students joined the activity? ___',
    sents: [
      'On {T1} a scientist gave a talk on space at our school.',
      'She showed pictures of the {N1@tech} used in space travel.',
      'The {PLACE1} was full of students who love science.',
      'She said a rocket must travel fast to leave the earth.',
      '{NUM1} students joined the question-and-answer part after the talk.',
      'Many of them hoped to study {N2@subject} at university.',
      'The scientist asked us to stay {A1@curious} and keep asking why.',
      'The activity made science feel {A2@outing} instead of difficult.',
    ],
    facts: ['when', 'howMany'],
  },
  {
    id: 'senread-culture',
    mainIdea: '跨文化交流中的一次误会',
    howManyQ: 'According to the passage, how many days did the exchange programme last? ___',
    sents: [
      'A student from abroad came to our school for a {NUM1}-day exchange programme.',
      'She stayed with a family near the {PLACE1}.',
      'At first they had a small misunderstanding about daily {N1@news}.',
      'Thanks to the host family, the problem was solved {R1@leisure}.',
      'They cooked {N2@food} together on the evening of {T1}.',
      'She recorded everything and shared {HISHER} {N3@interview} online.',
      'The story received many comments from readers that night.',
      'Everyone agreed that direct talk works better than silence.',
    ],
    facts: ['howMany', 'where'],
  },
];

/**
 * 七选五（gapped）：`sents` 是完整行文，`gaps` 抽走其中 5 句成空（0 起序号），
 * 被抽走的句子就是正解；`distractors` 是 2 个**放不进任何位置**的干扰句
 * —— 每题给同一份 7 句选项（5 正 + 2 干扰），与真实题型一致。
 */
export const GAPPED_SKELETONS = [
  {
    id: 'gap-method',
    sents: [
      'Many students want to improve their English but do not know how to start.',
      'First, set a clear and realistic goal for each week.',
      'Second, practise speaking with a partner whenever you have a chance.',
      'Third, review what you have learned before you go to sleep.',
      'A notebook of useful sentences also helps a lot in writing.',
      'Fourth, listen to short English programmes twice a week.',
      'In short, a good method makes progress much easier.',
      'Do not try to remember everything in a single night.',
    ],
    gaps: [1, 2, 3, 5, 6],
    distractors: [
      'The weather in that city is usually freezing in winter.',
      'He bought a new bike and rode it to the market every Sunday.',
    ],
  },
  {
    id: 'gap-survey',
    sents: [
      'A recent survey asked students how they spend their free time.',
      'Some students reported that they spend most of their time online.',
      'About half said they prefer outdoor activities to computer games.',
      'Sports and short trips were chosen by a large number of students.',
      'Reading remains the third most popular choice among them.',
      'The survey covered more than one thousand students in different schools.',
      'The results surprised many teachers in our city.',
      'Music and drawing also became popular among girls in recent years.',
      'Young people still enjoy activities that help them relax.',
      'Experts suggest that a balanced plan is the key to a happy school life.',
    ],
    gaps: [1, 3, 5, 7, 9],
    distractors: [
      'The price of oil rose sharply in the international market last week.',
      'My little sister prefers milk to juice before she goes to bed.',
    ],
  },
  {
    id: 'gap-hobby',
    sents: [
      'Hobbies are more than simple ways to kill time.',
      'They can also open a door to a future job or a lifelong interest.',
      'A student who loves painting may discover talent in art classes.',
      'Sports build courage, and team games teach players to cooperate.',
      'Music, for example, trains the ear and the memory at the same time.',
      'People with hobbies usually feel less stressed after busy days.',
      'They also teach us to keep trying when something is difficult.',
      'That is why schools often encourage students to join clubs.',
      'In other words, a good hobby can change the way we study.',
      'Choose one hobby, give it time, and you may surprise yourself.',
    ],
    gaps: [1, 3, 5, 7, 9],
    distractors: [
      'The bus timetable changed again because of the road repair near the station.',
      'She put the umbrella into her bag before she left the classroom.',
    ],
  },
  {
    id: 'gap-health',
    sents: [
      'Keeping healthy does not require expensive equipment.',
      'Small changes in daily life make a bigger difference than people expect.',
      'A twenty-minute walk after dinner is already a good beginning.',
      'Regular sleep keeps the mind clear, especially before an exam.',
      'Breakfast gives the brain the energy it needs for the first class.',
      'Students who skip breakfast often feel tired in the morning.',
      'Water is better than sweet drinks during a long school day.',
      'Stretching between lessons protects the back and the eyes.',
      'These small habits cost nothing but work very well.',
      'Start with one habit and keep it for a month before adding another.',
    ],
    gaps: [1, 3, 5, 7, 9],
    distractors: [
      'The museum will close earlier during the national holiday this year.',
      'He scored twice in the second half and his team won the match.',
    ],
  },
  {
    id: 'gap-travel',
    sents: [
      'Travelling alone for the first time can be both exciting and difficult.',
      'The secret is to prepare the important things before you leave.',
      'A light bag makes it easier to move from one place to another.',
      'Keeping your passport and money in safe places is never a waste of time.',
      'Writing down daily costs also helps you stay within the budget.',
      'A short list of stops keeps the whole journey simple and clear.',
      'Talking with local people often gives you stories no guidebook has.',
      'These conversations are usually the best memories of a trip.',
      'Most importantly, keep your plans a little flexible.',
      'A small change of plan may lead to something even better.',
    ],
    gaps: [1, 3, 5, 7, 9],
    distractors: [
      'The library purchased five hundred new books for the reading week.',
      'My neighbour practices the piano every evening without exception.',
    ],
  },
];

/**
 * 语法填空（高考）：短文 10 空。
 *   · `Gv<序>|<原形>|<形态>` 有提示词 → 空后给 `(原形)`，答案查动词变位表
 *   · `Ga<序>|<形容词>|<comp|sup>` → 空后给 `(形容词)`，多音节比较/最高级
 *   · `Gf<序>|<答案>|<选项组>` 无提示词 → 空后不给词，答案在句中已定
 * 与初中的「单句四选一」不同：空在**篇章**里，靠上下文定形态 —— 这才是语法填空。
 */
export const SENIOR_GRAMMAR_FILL_SKELETONS = [
  {
    id: 'gfill-letter',
    sents: [
      'Dear Tom,',
      'I have {Gv1|write|pp} to you several times since last term.',
      'Last month I {Gv2|take|past} part in a speech contest in our {N1@place}.',
      'The topic was {Gf1|about|prep} how to protect the environment.',
      'My teacher said the practice was {Ga1|important|comp} for me.',
      'Everything here is fine, {Gf2|except|prep} the cold weather.',
      'It has been two years since we {Gv3|meet|past} at the summer camp.',
      'I am looking forward to {Gv4|hear|ing} from you.',
      'My parents send their greetings to your family.',
      'Please write back when you {Gv5|finish|s} your exams.',
      'The photos I took will {Gv6|speak|b} for themselves.',
      'Yours, Li Hua',
    ],
  },
  {
    id: 'gfill-science',
    sents: [
      'Science is changing our life in many ways.',
      'With the help of modern {N1@tech}, people can work at home.',
      'A report {Gv1|come|pp} out last week says that online study is rising.',
      'Students who study online should be {Ga1|careful|comp} with their time.',
      'The teacher explained the rule {Gf1|in|prep} a clear voice.',
      'Not everyone agrees {Gf2|that|rel} this method is perfect.',
      'Some students keep {Gv2|lose|ing} their notes after a long screen time.',
      'Experts suggest {Gv3|take|ing} a short break every hour.',
      'A good plan can {Gv4|make|b} online study much easier.',
      'The problem usually {Gv5|get|s} better after a short break.',
      'That is why {Gf3|both|det} teachers and parents care about it.',
    ],
  },
  {
    id: 'gfill-travel',
    sents: [
      'Last summer our family took a trip to a small town by the sea.',
      'We arrived there {Gf1|at|prep} five in the afternoon.',
      'The town is {Ga1|famous|comp} for its old {N1@road}.',
      'My father {Gv1|take|past} many photos along the beach.',
      'I {Gv2|see|b} so many fishing boats for the first time.',
      'The local people were kind {Gf2|to|prep} visitors like us.',
      'We had {Gv3|eat|pp} seafood in a small restaurant.',
      'The trip ended with a wonderful evening show.',
      'It was one of the {Ga2|wonderful|sup} trips I have ever had.',
      'My mother {Gv4|take|s} a short video of the sunset.',
      'I hope we can {Gv5|go|b} there again next summer.',
    ],
  },
  {
    id: 'gfill-reading',
    sents: [
      'Reading is still one of the {Ga1|useful|sup} ways to learn.',
      'A student who reads widely usually writes {Gf1|better|adv} than others.',
      'Last year our school {Gv1|build|past} a reading corner in the {N1@fac}.',
      'Since then more and more students {Gv2|come|b} to the corner.',
      'The corner is open to {Gf2|any|det} student who loves books.',
      'Teachers advise us {Gv3|spend|ing} at least thirty minutes a day on it.',
      'Some books are {Ga2|interesting|comp} than others, of course.',
      'Good readers often ask questions {Gf3|while|conj} they read.',
      'They also keep notes in a small notebook.',
      'That habit alone {Gv4|make|s} learning much easier.',
    ],
  },
  {
    id: 'gfill-sport',
    sents: [
      'Our school {Gv1|hold|past} a sports meeting last Friday.',
      'The {N1} was full of students and teachers that morning.',
      'Jack ran {Gf1|faster|adv} than anyone in his class.',
      'His coach was {Ga1|satisfied|comp} with the result.',
      'Team sports teach us to {Gv2|work|b} with others.',
      'Some students prefer {Gv3|sit|ing} at home after class.',
      'A short run in the evening helps them sleep {Gf2|well|adv}.',
      'Health always comes {Gf3|first|adv} in our class.',
      'The runners who {Gv4|run|past} hard finally won the team prize.',
      'So do some sport every day, {Gf4|and|conj} you will feel better.',
      'Everyone cheered when they crossed the finish line.',
    ],
  },
  {
    id: 'gfill-festival',
    sents: [
      'The Mid-Autumn Festival is one of the {Ga1|important|sup} festivals in China.',
      'People {Gv1|get|b} together with their families every year.',
      'My grandmother always {Gv2|make|past} mooncakes by hand.',
      'My father {Gv3|buy|past} a big lantern for the festival this year.',
      'The guests were {Ga2|interested|comp} in the {N1@food} we prepared.',
      'We showed them {Gf1|how|rel} to cut the mooncakes fairly.',
      'Everyone enjoyed the evening {Gf2|although|conj} it was a little cold.',
      'The foreigners kept {Gv4|take|ing} photos of the bright moon.',
      'The festival gave us a chance to share our culture.',
      'Everyone shared the mooncakes and told old stories.',
      'The evening was {Ga3|meaningful|comp} for all of us.',
    ],
  },
];

/** 语法填空里「无提示词」空的选项组（答案由骨架烧死，选项成组给） */
export const FUNCTION_SETS = {
  prep: ['in', 'on', 'at', 'for', 'with', 'to', 'by', 'from', 'about', 'into', 'over', 'during', 'except'],
  conj: ['and', 'but', 'because', 'so', 'although', 'while', 'if', 'when'],
  rel: ['that', 'which', 'who', 'what', 'where', 'when', 'how'],
  art: ['a', 'an', 'the', '—'],
  det: ['some', 'any', 'every', 'no', 'another', 'both'],
  adv: ['well', 'better', 'best', 'hard', 'fast', 'faster', 'first', 'early', 'late'],
};

/** 高考应用文写作（80 词） */
export const SENIOR_WRITING = [
  { genre: '建议信', prompt: '你收到英国笔友的来信，他说英语写作总是拿不到高分。请回信给出两条具体建议。', min: 80, max: 100 },
  { genre: '建议信', prompt: '你校食堂浪费现象严重。请给校长写一封信，提出至少两条改进措施。', min: 80, max: 100 },
  { genre: '邀请信', prompt: '你校将举办英语戏剧节。请写邮件邀请外教 Mr. Smith 担任评委并说明安排。', min: 80, max: 100 },
  { genre: '邀请信', prompt: '你的朋友想了解中国春节。请写邮件邀请他来你家过节，并介绍两项活动。', min: 80, max: 100 },
  { genre: '申请信', prompt: '你希望加入学校的英语广播站。请写一封申请信，说明你的优势与打算。', min: 80, max: 100 },
  { genre: '申请信', prompt: '你申请担任国际交流活动的志愿者。请写信说明你的相关经历与优势。', min: 80, max: 100 },
  { genre: '感谢信', prompt: '你在交换期间受到一户当地家庭的照顾。请写信感谢他们并回忆一件小事。', min: 80, max: 100 },
  { genre: '道歉信', prompt: '你因病未能参加好友的生日聚会。请写信道歉并说明情况、提出补救办法。', min: 80, max: 100 },
  { genre: '通知', prompt: '你校将举行英语演讲比赛。请以学生会名义写一则英文通知（时间、地点、要求）。', min: 80, max: 100 },
  { genre: '通知', prompt: '学校图书馆将举办「一本好书」分享会。请写一则英文通知。', min: 80, max: 100 },
  { genre: '邮件', prompt: '你参加了为期一周的研学旅行。请给国外笔友写邮件介绍行程与收获。', min: 80, max: 100 },
  { genre: '邮件', prompt: '你的笔友想来你的城市上大学。请写邮件介绍这座城市与一所大学。', min: 80, max: 100 },
  { genre: '发言稿', prompt: '请以 Learning from Failure 为题写一篇国旗下讲话的英文发言稿。', min: 80, max: 100 },
  { genre: '发言稿', prompt: '请写一篇英文发言稿，在班会上介绍一次让你成长的挑战。', min: 80, max: 100 },
  { genre: '介绍信', prompt: '请写邮件向外国朋友介绍一项中国传统文化（节日/技艺/饮食任选其一）。', min: 80, max: 100 },
  { genre: '介绍信', prompt: '请写邮件介绍你所在社区的一项便民变化，并说明你的看法。', min: 80, max: 100 },
  { genre: '话题作文', prompt: '以 The Power of Small Steps 为题，论述小步坚持为何比一次性努力更有效。', min: 80, max: 100 },
  { genre: '话题作文', prompt: '以 What Makes a Good Teammate 为题，谈谈优秀队友的两项品质并举例。', min: 80, max: 100 },
  { genre: '话题作文', prompt: '以 My View on Online Learning 为题，谈谈在线学习的优点与不足。', min: 80, max: 100 },
  { genre: '话题作文', prompt: '以 Protecting the Environment Starts from Us 为题，写出两条你能坚持的做法。', min: 80, max: 100 },
  { genre: '话题作文', prompt: '以 A Person Who Influenced Me 为题，描述一个人及其对你的影响。', min: 80, max: 100 },
  { genre: '话题作文', prompt: '以 Reading Beyond Textbooks 为题，谈谈课外阅读对你的帮助。', min: 80, max: 100 },
  { genre: '图表作文', prompt: '下图是某校学生课外活动时间分配的调查结果。请描述图表并分析原因。', min: 80, max: 100 },
  { genre: '图表作文', prompt: '下图是近五年某市共享单车使用数量的变化。请描述趋势并给出你的预测。', min: 80, max: 100 },
  { genre: '书信', prompt: '你收到一封求助信：朋友即将转学，感到难过。请回信安慰并给出建议。', min: 80, max: 100 },
  { genre: '书信', prompt: '你向出版社推荐一本好书。请写信说明推荐理由与适合的读者。', min: 80, max: 100 },
  { genre: '投稿', prompt: '向校报英文版投稿：以 One Meaningful Volunteer Day 为题记一次志愿活动。', min: 80, max: 100 },
  { genre: '投稿', prompt: '向校报英文版投稿：介绍你所在班级最近开展的一项活动。', min: 80, max: 100 },
  { genre: '话题作文', prompt: '以 How to Manage Your Time 为题，给出三条可执行的时间管理建议。', min: 80, max: 100 },
  { genre: '话题作文', prompt: '以 The Value of Honesty 为题，用一个事例说明诚实的价值。', min: 80, max: 100 },
];

/** 高考读后续写：给定段落 + 续写要求（两段式，150 词左右） */
export const SENIOR_CONTINUATION = [
  {
    genre: '读后续写',
    prompt: '阅读下面材料，根据其内容和所给段落开头语续写两段，使之构成一篇完整的短文。',
    passage: 'Last Sunday, on the way home from the library, I found a wallet lying on the ground. Inside there was some money and a student card with a name I did not know. I decided to wait for the owner instead of going home right away.',
    sub: '段落一：Suddenly, a worried girl came back and looked around carefully.\n段落二：After she got the wallet back, she invited me to…',
    min: 110, max: 150,
  },
  {
    genre: '读后续写',
    prompt: '阅读下面材料，根据其内容和所给段落开头语续写两段，使之构成一篇完整的短文。',
    passage: 'Our class planned to give the head teacher a special gift on Teachers\' Day. We had only three days and very little money, so we had to think of something simple but meaningful. Everyone offered an idea, but none of us felt sure.',
    sub: '段落一：Just then, Lily raised her hand and said, "What about…"\n段落二：On that afternoon, when the teacher opened the door, she…',
    min: 110, max: 150,
  },
  {
    genre: '读后续写',
    prompt: '阅读下面材料，根据其内容和所给段落开头语续写两段，使之构成一篇完整的短文。',
    passage: 'I had promised to take part in the school running race, but a bad cold kept me in bed for a whole week. With only two days left before the race, my father asked me whether I still wanted to run.',
    sub: '段落一：Looking out of the window, I made up my mind.\n段落二：When the starting gun finally went off, I…',
    min: 110, max: 150,
  },
  {
    genre: '读后续写',
    prompt: '阅读下面材料，根据其内容和所给段落开头语续写两段，使之构成一篇完整的短文。',
    passage: 'The old man always sat alone at the end of the park bench every evening. One day my friend and I decided to say hello to him. He smiled, but he did not say a word, and we began to wonder whether he could hear us.',
    sub: '段落一：The next evening, we brought a small gift with us.\n段落二：Only then did we learn why he came to the park every day…',
    min: 110, max: 150,
  },
  {
    genre: '读后续写',
    prompt: '阅读下面材料，根据其内容和所给段落开头语续写两段，使之构成一篇完整的短文。',
    passage: 'Our basketball team was losing by ten points in the last quarter. Nobody spoke in the timeout until our captain stood up and said that the game was not over yet.',
    sub: '段落一：Back on the court, we changed our plan completely.\n段落二：With three seconds left, the ball came to my hands…',
    min: 110, max: 150,
  },
  {
    genre: '读后续写',
    prompt: '阅读下面材料，根据其内容和所给段落开头语续写两段，使之构成一篇完整的短文。',
    passage: 'When the new student arrived, everyone noticed that she always ate lunch alone. One noon, instead of joining my friends, I walked towards her table and put my lunch box down.',
    sub: '段落一：She looked at me in surprise, and then…\n段落二：A month later, when she finally spoke in class…',
    min: 110, max: 150,
  },
  {
    genre: '读后续写',
    prompt: '阅读下面材料，根据其内容和所给段落开头语续写两段，使之构成一篇完整的短文。',
    passage: 'My grandfather kept a small notebook in which he wrote down one sentence every day. Curious, I opened it one afternoon and found that the last page was dated ten years ago.',
    sub: '段落一：I ran to my grandfather and asked him about the date.\n段落二：That evening, I took out a notebook of my own and…',
    min: 110, max: 150,
  },
  {
    genre: '读后续写',
    prompt: '阅读下面材料，根据其内容和所给段落开头语续写两段，使之构成一篇完整的短文。',
    passage: 'The science competition was only two weeks away, and our model plane still could not fly properly. Tired and frustrated, some teammates wanted to give up and hand in the simplest project.',
    sub: '段落一：I picked up the broken wing and said that we still had time.\n段落二：On the day of the competition, our plane…',
    min: 110, max: 150,
  },
  {
    genre: '读后续写',
    prompt: '阅读下面材料，根据其内容和所给段落开头语续写两段，使之构成一篇完整的短文。',
    passage: 'It rained heavily on the morning of the sports meeting. Everyone believed the event would be put off, but the head teacher appeared on the playground with a smile.',
    sub: '段落一：He clapped his hands and told us to line up as usual.\n段落二：Later that day, something unexpected happened…',
    min: 110, max: 150,
  },
  {
    genre: '读后续写',
    prompt: '阅读下面材料，根据其内容和所给段落开头语续写两段，使之构成一篇完整的短文。',
    passage: 'I had always been afraid of speaking in front of a crowd. When our teacher asked for a volunteer to present the group project, my hand went up before I could think twice.',
    sub: '段落一：Standing in front of the class, my mind suddenly went blank.\n段落二：When I finished, the class…',
    min: 110, max: 150,
  },
];

/**
 * 考研（v1.9.1 阶段 E）素材。
 *
 * 阅读：派生自 SENIOR_READING_SKELETONS —— facts 从 2 项扩到 3 项
 *   （when/where/howMany），配合 detailQs=3 得到「3 细节 + 1 主旨 + 1 词义」
 *   = **5 题/篇**（E4 要求 4 篇 × 5 题）。
 *   **必须过滤掉缺 PLACE1 的骨架**：where 细节题的正解要能在文中查到，
 *   否则就是「正解不在文中」的病题（v1.8.x 修过的 bug 类型）。
 */
const KAOYAN_READING_ANCHORS = ['when', 'where', 'howMany'];
export const KAOYAN_READING_SKELETONS = SENIOR_READING_SKELETONS
  .filter((sk) => /\{PLACE1(@\w+)?\}/.test(sk.sents.join(' ')))
  .map((sk) => ({ ...sk, facts: KAOYAN_READING_ANCHORS }));

/**
 * 考研新题型（七选五）：与 SENIOR 的 5 个骨架同构，但**句中带槽位**
 * （{NAME}/{PLACE1}/{NUM1}/{T1} 等），配合 buildGapped 的 renderPassage
 * 填词产生变体 —— 否则 5 骨架 × 5 空只有 25 题，远达不到 E4 的 500+。
 *
 * 注意：句子必须**语义自洽到槽位可替换**，槽位只替换人名/地名/数字/时间
 * 这类不承载逻辑关系的成分，七选五的指代与逻辑链不受影响。
 * distractor（干扰项）同样带槽位，保证每个变体的 7 个选项互不相同。
 */
export const KAOYAN_GAPPED_SKELETONS = [
  {
    id: 'kgap-method',
    sents: [
      'Many students at {PLACE1} want to improve their English but do not know how to start.',
      'First, set a clear and realistic goal for each week.',
      'Second, practise speaking with a partner whenever you have a chance.',
      'Third, review what you have learned before you go to sleep.',
      'A notebook of useful sentences also helps a lot in writing.',
      'Fourth, listen to short English programmes twice a week.',
      'In short, a good method makes progress much easier.',
      'Do not try to remember everything in a single {NUM1}.',
    ],
    gaps: [1, 2, 3, 5, 6],
    distractors: [
      'The weather in {PLACE1} is usually freezing in winter.',
      '{NAME} bought a new bike and rode it to the market every {T1}.',
    ],
  },
  {
    id: 'kgap-survey',
    sents: [
      'A recent survey asked students at {PLACE1} how they spend their free time.',
      'Some students reported that they spend most of their time online.',
      'About half said they prefer outdoor activities to computer games.',
      'Sports and short trips were chosen by {NUM1} students in all.',
      'Reading remains the third most popular choice among them.',
      'The survey covered more than one thousand students in different schools.',
      'The results surprised many teachers in {PLACE1}.',
      'Music and drawing also became popular among girls in recent years.',
      'Young people still enjoy activities that help them relax.',
      'Experts suggest that a balanced plan is the key to a happy school life.',
    ],
    gaps: [1, 3, 5, 7, 9],
    distractors: [
      'The price of oil rose sharply in the international market last week.',
      '{NAME} prefers milk to juice before {HISHER} goes to bed every {T1}.',
    ],
  },
  {
    id: 'kgap-hobby',
    sents: [
      'Hobbies are more than simple ways to kill time.',
      'They can also open a door to a future job or a lifelong interest.',
      'A student who loves painting may discover talent in art classes.',
      'Sports build courage, and team games teach players to cooperate.',
      'Music, for example, trains the ear and the memory at the same time.',
      'People with hobbies usually feel less stressed after busy days.',
      'They also teach us to keep trying when something is difficult.',
      'That is why schools in {PLACE1} often encourage students to join clubs.',
      'In other words, a good hobby can change the way we study.',
      'Choose one hobby, give it {NUM1} weeks, and you may surprise yourself.',
    ],
    gaps: [1, 3, 5, 7, 9],
    distractors: [
      'The bus timetable changed again because of the road repair near {PLACE1}.',
      '{NAME} put the umbrella into {HISHER} bag before leaving the classroom.',
    ],
  },
  {
    id: 'kgap-health',
    sents: [
      'Keeping healthy is not as hard as most students think.',
      'A balanced breakfast gives you enough energy for the whole morning.',
      'Drinking water often works better than sweet drinks.',
      'Walking to school for {NUM1} weeks already makes a difference.',
      'Sleeping early helps the brain remember what it has learned.',
      'Students at {PLACE1} who sleep late often feel tired in class.',
      'Short breaks between tasks also protect the eyes and the back.',
      'A weekend walk with friends is both exercise and fun.',
      'The point is to keep the habit rather than to be perfect.',
      'Start with one small change this {T1} and keep it up.',
    ],
    gaps: [1, 3, 5, 7, 9],
    distractors: [
      'The library near {PLACE1} will close early because of the holiday.',
      '{NAME} left {HISHER} notebook in the classroom last {T1}.',
    ],
  },
  {
    id: 'kgap-travel',
    sents: [
      'Travelling teaches things that a classroom cannot.',
      'It shows us how people in other places live their daily lives.',
      'A short trip to {PLACE1} can explain a history book better than a lecture.',
      'Travellers learn to read maps, ask for help and save money.',
      'They also learn to accept that not everything goes as planned.',
      'Sharing a room with strangers builds patience and trust.',
      'After the trip {NAME} wrote down {NUM1} pages of notes.',
      'Those notes later became the best part of the travel journal.',
      'Of course, safety always comes first in every journey.',
      'Travel far, but always remember to come back with an open mind.',
    ],
    gaps: [1, 3, 5, 7, 9],
    distractors: [
      'The flight to {PLACE1} was delayed by heavy snow last {T1}.',
      '{NAME} returned {HISHER} library books before the exam week.',
    ],
  },
  {
    id: 'kgap-teamwork',
    sents: [
      'No single student can finish a large project alone.',
      'Good teams divide the work according to what each member does best.',
      'A clear plan keeps everyone moving in the same direction.',
      'Regular short meetings help the team in {PLACE1} catch mistakes early.',
      'When a problem appears, members discuss it instead of blaming each other.',
      '{NAME} once led a group of {NUM1} students to finish a model plane.',
      'They failed twice before the final design finally worked.',
      'The failure taught them more than any textbook could.',
      'In the end the team celebrated not only the result but the process.',
      'That is why employers value teamwork so much.',
    ],
    gaps: [1, 3, 5, 7, 9],
    distractors: [
      'The canteen at {PLACE1} will add new dishes from next {T1}.',
      '{NAME} borrowed two books from the library and forgot to renew them.',
    ],
  },
];


/**
 * 考研完形填空（E4：20 空/篇，与中考/高考的 10 空不同，由 `L.clozeBlanks: 20` 驱动）。
 *
 * 每个骨架恰有 **20 个不同的可空键**（BLANKABLE：`[ANRV]\d+(@pool)?` / `T\d+(@pool)?`）。
 * 同键在一篇里只算一个空（renderPassage 按 key 复用槽位），所以必须用 20 个不同键。
 *
 * 句框设计约束：干扰项从**同一个池**随机取，但**答案也是从池里随机取** ——
 * 因此句框必须能容纳该池的**每一个**词，否则会出现「正解语法不通」的病题。
 * 下列句框均按此标准写（如 `do` 池 do/finish/start/check/share 都能接 `their jobs`）。
 */
export const KAOYAN_CLOZE_SKELETONS = [
  {
    id: 'kcloze-remote',
    theme: '远程办公',
    sents: [
      'Last {T1}, a research team studied how people work at home.',
      'About {NUM1} workers joined the study in {PLACE1}.',
      'Most of them said the {N1@method} was simple but useful.',
      'They could {V1@do} their jobs without a long trip.',
      'However, staying {A1@room} at home is not always easy.',
      'Small tasks around the {N2@home} often break their focus.',
      'Some workers feel {A2@feel} when a deadline is near.',
      'Others {V2@goish} out for a short walk to rest the mind.',
      'A short walk {R1@really} helps them come back to work.',
      'The workers {V3@laughPast} at the good news from the office.',
      'Early birds {V4@do} their hard work in the morning.',
      'Night owls like to work {R2@leisure} when the house is silent.',
      'By {T2} the team had collected notes from every group.',
      'The {N4@news} was shared with readers the following week.',
      'A break of {NUM2} minutes is often enough to rest the eyes.',
      'Workers who take breaks make {A3@easy} mistakes less often.',
      'Students in the same trial remember things {R3@study}.',
      'The team {V5@newsPast} the whole story the next day.',
      'Everybody wants to {V6@support} the team in a busy week.',
      'The study was done at a {N5@work} near {PLACE2}, and by {T4} everyone agreed that resting was {A4@habit}.',
    ],
  },
  {
    id: 'kcloze-club',
    theme: '校园社团',
    sents: [
      'Every {T1} the student union in {PLACE1} holds a club fair.',
      'New members come to {N1@schoolObj} tables and ask questions.',
      'The fair gives students a {A1@easy} way to choose a hobby.',
      'Some join a club just to {V1@do} something after class.',
      'Others hope the club will {V2@help} them make new friends.',
      'A good club also teaches members to {V3@support} each other.',
      'Last year more than {NUM1} students signed up for sports.',
      'The swimming group was the {A2@outing} choice of all.',
      'It trained {R1@freq} and never missed a single week.',
      'Reading clubs meet in the {N2@fac} on quiet afternoons.',
      'Members {V4@do} their homework together before they talk.',
      'The drama club {V5@playPast} a short play at the end of {T2}.',
      'Everyone agreed the show was a great {N3@memory}.',
      'Teachers said the clubs {A3@habit} value was hard to measure.',
      'Club life also {R2@known} improves a student’s confidence.',
      'By {T3} the union had built {NUM2} clubs in total.',
      'The union {V6@rememberPast} to keep the fair every term.',
      'Students who stay long enough often {V7@talkV} about it for years.',
      'One report in the {N4@news} listed the ten most popular clubs.',
      'In short, a club is a {N5@chance} that no student should miss.',
    ],
  },
  {
    id: 'kcloze-city',
    theme: '城市交通',
    sents: [
      'Traffic in big cities has become a {A1@easy} problem to describe.',
      'Every {T1} the roads near {PLACE1} are crowded with cars.',
      'City planners {V1@do} a study of how people move around.',
      'They found that {NUM1} percent of drivers go to work alone.',
      'City planners also study the {N1@light} along the road.',
      'A good {N2@method} can take cars off the road quickly.',
      'People who {V2@goish} by bike need safe lanes near {PLACE2}.',
      'A new {N3@road} was built beside the river last year.',
      'In one city the new plan {V3@winPast} a national prize.',
      'The plan cost less than {NUM2} million and was {A3@easy} to build.',
      'Some drivers {R1@really} dislike the change, of course.',
      'Others {V4@help} their neighbours get to work together.',
      'The {N4@news} covered the story for several days in {T2}.',
      'Officials said the {A4@habit} value would grow over time.',
      'Traffic deaths fell, which {V5@newsPast} in every local paper.',
      'Families now walk to the {N5@work} near their homes at {T3}.',
      'Shops along the street report more customers on foot.',
      'The city also plans to {V6@support} electric buses from next year.',
      'A {N6@vehicle} like this runs quietly and pollutes much less.',
      'All in all, the change was {R2@known} welcomed by residents.',
    ],
  },
  {
    id: 'kcloze-reading',
    theme: '阅读习惯',
    sents: [
      'Reading is a {A1@habit} habit that many students give up too early.',
      'A survey in {PLACE1} asked {NUM1} young people about their reading.',
      'Most of them said they read less than one {N1@bookish} a month.',
      'The main reason was a lack of {A2@room} time in the evening.',
      'Some said the {N2@tech} world simply {V1@do} too many things at once.',
      'Others {V2@talkV} about the pressure of exams and homework.',
      'Experts say a reader should {V3@support} a fixed time each day.',
      'Even ten {R1@freq} minutes can build a lasting habit.',
      'The survey {V4@newsPast} that students who read more felt calmer.',
      'They also {A3@feel} more confident when they spoke in class.',
      'A reading group in {PLACE2} meets every {T1} after school.',
      'Members bring one {N2@bookish} and {V5@do} a short report.',
      'The group {V6@help} shy students practise speaking in public.',
      'By {T2} it had grown to {NUM2} regular members.',
      'Libraries say the {N3@method} works better than any lecture.',
      'Young readers choose books that match their level.',
      'One teacher {V7@rememberPast} the days when she read under a tree.',
      'Such {N4@memory} often returns when a student opens an old book.',
      'That is why schools hold reading weeks every spring.',
      'In the end, the {T3} lesson is simple: read a little, {V8@do} it daily.',
    ],
  },
];


/**
 * 考研写作（E4：200+，应用文 + 短文）。
 *
 * 手写 200+ 条既慢又易重复，故用**体裁模板 × 话题**程序化展开：
 *   · 话题驱动体裁（建议/邀请/通知/发言稿/介绍/话题作文）套同一个中文话题，
 *     每类句式都能自然容纳任意话题 → 语义不跑偏；
 *   · 固定场景体裁（感谢/道歉/申请/图表作文）逐条手写，因为它们
 *     依赖具体情境而非话题。
 *
 * 字数按考研口径：应用文 100–120 词、短文 160–200 词。
 */
const KAOYAN_TOPICS = [
  '如何养成良好的学习习惯', '时间管理的三个方法', '校园里的浪费现象', '网络学习的利与弊',
  '阅读纸质书与电子书的选择', '体育锻炼的重要性', '垃圾分类与环境保护', '传统文化的传承',
  '志愿服务的意义', '团队合作与个人表现', '人工智能对生活的影响', '城市与乡村生活的差异',
  '健康饮食与作息', '大学生就业准备', '压力与心理健康', '语言学习的方法',
  '交通出行方式的选择', '消费观念与节约', '邻里关系与社区建设', '创新与实践能力',
  '诚信与考试纪律', '社交媒体与人际沟通', '终身学习的必要性', '文化遗产与旅游发展',
  '绿色出行与低碳生活', '阅读与写作能力的培养', '校园安全与自我保护', '合作学习的益处',
  '时间与效率的关系', '青年人的责任与担当',
];
const KAOYAN_EN_TITLES = [
  'The Power of Small Habits', 'What Makes a Good Teammate', 'My View on Online Learning',
  'Reading Beyond Textbooks', 'The Value of Honesty', 'How to Manage Your Time',
  'Learning from Failure', 'A Person Who Influenced Me', 'Protecting the Environment Starts from Us',
  'Books vs. Screens', 'The Meaning of Volunteer Work', 'Health Comes First',
  'Skills Every Student Needs', 'Living in a Fast-changing World', 'Why We Should Keep Writing by Hand',
  'The Role of Family in Education', 'Making the Most of Your Spare Time', 'Cities That Care for People',
  'Courage to Ask Questions', 'A Small Act of Kindness', 'Technology and True Friendship',
  'What Success Really Means', 'Growing Through Challenges', 'Respect for Different Cultures',
  'The Habit of Asking Why', 'Strength in Diversity', 'Focus in a Distracted Age',
  'Gratitude and Growth', 'Practice Makes Progress', 'Choosing a Meaningful Career',
];

export const KAOYAN_WRITING = (() => {
  const out = [];
  // 1) 话题驱动体裁：6 类 × 30 话题 = 180
  const topicGenres = [
    { genre: '建议信', min: 100, max: 120, tpl: (t) => `你的英国笔友来信说「${t}」让他很困扰。请回信给出两条具体、可执行的建议，并说明理由。` },
    { genre: '邀请信', min: 100, max: 120, tpl: (t) => `你校将举办以「${t}」为主题的英语活动。请写邮件邀请外教 Mr. Smith 担任评委，并说明时间、地点与流程。` },
    { genre: '通知', min: 100, max: 120, tpl: (t) => `学生会将围绕「${t}」举办英语演讲比赛。请以学生会名义写一则英文通知，含时间、地点、参赛要求与报名方式。` },
    { genre: '发言稿', min: 100, max: 120, tpl: (t) => `请以「${t}」为话题，写一篇在班会上发言的英文稿，至少给出两条具体做法。` },
    { genre: '介绍信', min: 100, max: 120, tpl: (t) => `请写邮件向外国朋友介绍你所在学校在「${t}」方面的一项做法，并说明其效果。` },
    { genre: '话题作文', min: 160, max: 200, tpl: (t) => `请以「${t}」为话题写一篇英文短文，先描述现象，再给出你的看法与理由（至少两点）。` },
  ];
  for (const g of topicGenres) {
    for (const t of KAOYAN_TOPICS) out.push({ genre: g.genre, prompt: g.tpl(t), min: g.min, max: g.max });
  }
  // 2) 英文题目作文（考研大作文常见形式）：30 条
  for (const title of KAOYAN_EN_TITLES) {
    out.push({ genre: '短文', prompt: `以 "${title}" 为题写一篇英文短文，观点明确、层次清楚，并用具体例子支撑。`, min: 160, max: 200 });
  }
  // 3) 固定场景体裁（依赖具体情境，逐条手写）：16 条
  const fixed = [
    ['感谢信', '你在交换学习期间受到导师的悉心指导。请写信感谢他，并回忆一件让你印象最深的小事。', 100, 120],
    ['感谢信', '你借用了同学的笔记并顺利通过考试。请写信致谢，并说明你打算如何回报。', 100, 120],
    ['感谢信', '你在迷路时得到一位当地人的帮助。请写信感谢他，并告知那次帮助对你的意义。', 100, 120],
    ['感谢信', '你校图书馆老师帮你找回了遗失的资料。请写一封感谢信，说明经过与你的感激之情。', 100, 120],
    ['道歉信', '你因临时有事未能参加同学的毕业聚会。请写信道歉，说明原因并提出补救办法。', 100, 120],
    ['道歉信', '你把借来的书弄丢了。请写信向书的主人道歉，并商议赔偿方式。', 100, 120],
    ['道歉信', '你因记错时间错过了小组讨论，拖慢了进度。请写信向组员致歉并说明改进措施。', 100, 120],
    ['道歉信', '你把内部草稿误发给了外教。请写信说明情况、道歉并给出处理方案。', 100, 120],
    ['申请信', '你希望加入学校的英语广播站。请写一封申请信，说明你的优势、经历与打算。', 100, 120],
    ['申请信', '你申请担任国际学术会议的志愿者。请写信说明相关经历、语言能力与可投入的时间。', 100, 120],
    ['申请信', '你想申请学校的海外交换项目。请写信说明申请理由、学业规划与家庭支持。', 100, 120],
    ['申请信', '你申请在校报担任英文版编辑。请写信说明你的编辑经验与改进栏目的设想。', 100, 120],
    ['图表作文', '下图是某高校学生每周课外阅读时间的调查结果。请描述图表数据并分析其原因。', 160, 200],
    ['图表作文', '下图是近五年某市居民绿色出行比例的变化。请描述趋势并给出你的预测与建议。', 160, 200],
    ['图表作文', '下图是大学生兼职原因的分布情况。请描述图表并评论这一现象。', 160, 200],
    ['图表作文', '下图是某中学学生每日睡眠时长的统计。请描述数据差异并分析其影响。', 160, 200],
  ];
  for (const [genre, prompt, min, max] of fixed) out.push({ genre, prompt, min, max });
  return out;
})();


/**
 * PRETCO 特色素材（v1.9.1 阶段 F · 近似方案）。
 *
 * 探活结论（docs/probe-pretco.md）：公开领域无 PRETCO 词表，故词库数据复用 CET-4；
 * 本文件只提供 **PRETCO 特色题型** 的素材 —— 语法结构、英译汉、听力短对话、应用文。
 *
 * 听力短对话：2–4 轮 + 一道理解题。`answer` 是中文正解（对话考点），
 * `speak` 由 passage 承载（运行时 TTS 朗读）。句子带槽位 → 变体篇章，
 * 否则 20 骨架最多 20 题，到不了 E4/F3 的 800+。
 * 干扰项从 PRETCO_DIALOGUE_DECOYS 取（与正解同为「场景短语」，互不雷同）。
 */
export const PRETCO_DIALOGUE_DECOYS = [
  '讨论期末考试的复习计划', '比较两种品牌的价格差异', '抱怨食堂饭菜的质量',
  '询问图书馆的开放时间', '商量周末去哪里郊游', '说明迟到的原因并道歉',
  '推荐一本刚读完的小说', '介绍校园社团的招新安排', '讨论兼职工作的时薪',
  '描述一次旅行中的意外', '询问机场登机牌的办理', '讨论如何减少塑料使用',
  '商量合租房子的分摊费用', '说明课程设计的进度', '请教邮件写作的格式',
  '讨论运动会的报名项目', '描述新邻居的第一印象', '询问医院挂号的流程',
  '商量归还借书的日期', '讨论宿舍熄灯时间的调整', '介绍家乡的一道名菜',
  '询问地铁换乘的路线', '讨论一次小组展示的分工', '解释为什么改变了计划',
  '描述学习乐器的经历', '询问奖学金的申请条件', '讨论网购退换货的流程',
  '说明手机没电借充电器', '商量班级聚餐的时间地点', '询问实习面试的准备',
];

export const PRETCO_DIALOGUE_SKELETONS = [
  {
    id: 'pdlg-bus',
    question: 'What are the two speakers mainly doing?',
    answer: '问路并确认公交路线',
    sents: [
      'M: Excuse me, does this bus go to {PLACE1}?',
      'W: Yes, but you need to change at the {N1@road}.',
      'M: Thanks a lot. How long does it take?',
      'W: About {NUM1} minutes by {N2@vehicle}.',
    ],
  },
  {
    id: 'pdlg-library',
    question: 'What does the woman suggest the man do?',
    answer: '改天再来借书',
    sents: [
      'M: I want to borrow this book on {N1@bookish}.',
      'W: Sorry, it is out. You can {V1@do} it next {T1}.',
      'M: That is a pity. I need it today.',
      'W: Maybe the {N2@fac} has a copy.',
    ],
  },
  {
    id: 'pdlg-clinic',
    question: 'Why does the man feel worried?',
    answer: '担心自己的身体状况',
    sents: [
      'W: You look tired. What is {A1@feel} you?',
      'M: I have a headache and I feel very {N1@tired}.',
      'W: You should see a doctor at the {N2@work}.',
      'M: Thank you. I will go this {T1}.',
    ],
  },
  {
    id: 'pdlg-movie',
    question: 'What will the two speakers probably do next?',
    answer: '一起去看电影',
    sents: [
      'M: There is a good film on at the {N1@scene} tonight.',
      'W: Great! I have wanted to see it for {NUM1} weeks.',
      'M: Shall we book the {T1} show then?',
      'W: Sure. I will {V1@goish} with you after class.',
    ],
  },
  {
    id: 'pdlg-restaurant',
    question: 'What does the man order?',
    answer: '点了主食和饮料',
    sents: [
      'W: What would you like to {V1@eat}, sir?',
      'M: I will have the {N1@food} with some fresh {N2@crop}.',
      'W: Would you like {A1@fresh} vegetables with it?',
      'M: Yes, please. And the bill, {NUM1} dollars.',
    ],
  },
  {
    id: 'pdlg-weather',
    question: 'How is the weather today?',
    answer: '天气晴朗温暖',
    sents: [
      'W: What {A1@weather} weather we have today!',
      'M: Yes, it is warm and the {N1@scene} looks clear.',
      'W: Let us go {R1@leisure} to the park.',
      'M: Good idea. Take a {N2@rainGear} just in case.',
    ],
  },
  {
    id: 'pdlg-class',
    question: 'What did the teacher ask the students to do?',
    answer: '课后完成作业',
    sents: [
      'M: Miss, shall we hand in the {N1@homework} now?',
      'W: No, {V1@do} it before {T1} morning, please.',
      'M: Okay. Is the {N2@subject} test the same day?',
      'W: Yes, right after the first {N3@act}.',
    ],
  },
  {
    id: 'pdlg-sport',
    question: 'What are they talking about?',
    answer: '讨论运动会的准备',
    sents: [
      'M: Our class will {V1@play} in the school match.',
      'W: Have you practised at the {N1@sportPlace} yet?',
      'M: Not yet. We train every {T1} afternoon.',
      'W: Then you must run {R1@study} to win.',
    ],
  },
  {
    id: 'pdlg-shopping',
    question: 'What does the woman want to buy?',
    answer: '想买一件外套',
    sents: [
      'W: I need a warm {N1@colour} for the winter.',
      'M: This {A1@itemAdj} one is on sale today.',
      'W: How much does it cost?',
      'M: {NUM1} yuan, and you get a free {N2@colour}.',
    ],
  },
  {
    id: 'pdlg-travel',
    question: 'Where are the speakers going?',
    answer: '准备外出旅行',
    sents: [
      'M: Have you ever been to {PLACE1} before?',
      'W: No, but I {V1@goish} there next month.',
      'M: Take a {N1@vehicle} — it is faster than a bus.',
      'W: Good point. I will book it this {T1}.',
    ],
  },
  {
    id: 'pdlg-job',
    question: 'What is the man looking for?',
    answer: '正在找工作',
    sents: [
      'W: Are you still looking for a {N1@chance}?',
      'M: Yes, I sent out {NUM1} applications last week.',
      'W: Maybe you should {V1@do} a clearer resume.',
      'M: I will {V2@do} that tonight.',
    ],
  },
  {
    id: 'pdlg-study',
    question: 'What does the woman advise?',
    answer: '建议制定学习计划',
    sents: [
      'M: I cannot keep up with all the {N1@homework}.',
      'W: You should make a plan and {V1@do} it step by step.',
      'M: Will that really {A1@habit} help?',
      'W: It will, if you start this {T1}.',
    ],
  },
  {
    id: 'pdlg-neighbour',
    question: 'What is the problem?',
    answer: '邻居噪音打扰休息',
    sents: [
      'W: The flat above us is very noisy at night.',
      'M: I know. It {V1@do} my head in every {T1}.',
      'W: Shall we write a note to the {N1@neighbour}?',
      'M: Yes, let us {V2@talkV} to them tomorrow.',
    ],
  },
  {
    id: 'pdlg-email',
    question: 'What does the man ask the woman to do?',
    answer: '帮忙检查邮件',
    sents: [
      'M: Could you {V1@do} me a favour with this email?',
      'W: Of course. Is the {N1@news} ready to send?',
      'M: Almost. Just check the {N2@note} at the end.',
      'W: Sure, I will read it {R1@leisure}.',
    ],
  },
  {
    id: 'pdlg-hobby',
    question: 'What does the woman enjoy?',
    answer: '喜欢画画的爱好',
    sents: [
      'W: I spend my free time on {N1@hobby}.',
      'M: Really? How often do you {V1@play}?',
      'W: Almost every {T1}. It helps me relax.',
      'M: That sounds {A1@outing} fun.',
    ],
  },
  {
    id: 'pdlg-news',
    question: 'What did the man read?',
    answer: '读了一篇报道',
    sents: [
      'M: I read an interesting {N1@news} today.',
      'W: What was it about?',
      'M: It was about the new {N2@road} near {PLACE1}.',
      'W: I will {V1@do} it after dinner.',
    ],
  },
  {
    id: 'pdlg-money',
    question: 'What is the woman worried about?',
    answer: '担心花钱太多',
    sents: [
      'W: I have spent too much money this month.',
      'M: You should {V1@do} a budget and save {NUM1}.',
      'W: You are right. I {A1@feel} bad about it.',
      'M: Start from this {T1}.',
    ],
  },
  {
    id: 'pdlg-team',
    question: 'What does the man propose?',
    answer: '提议分工合作',
    sents: [
      'M: Let us divide the work {R1@leisure}.',
      'W: Good. I will {V1@do} the slides.',
      'M: Then I will write the {N1@note}.',
      'W: We can {V2@talkV} about it at {T1}.',
    ],
  },
  {
    id: 'pdlg-food',
    question: 'What does the woman think of the food?',
    answer: '觉得饭菜不错',
    sents: [
      'W: The {N1@food} here tastes really good.',
      'M: Yes, and the {A1@fresh} fruit is cheap too.',
      'W: Shall we {V1@eat} here again next week?',
      'M: Sure, maybe on {T1}.',
    ],
  },
  {
    id: 'pdlg-apology',
    question: 'Why does the man apologise?',
    answer: '因迟到而道歉',
    sents: [
      'M: I am sorry I am late for the {N1@act}.',
      'W: That is all right. What {A1@feel} happened?',
      'M: The traffic was heavy and the {N2@vehicle} broke down.',
      'W: Please {V1@do} not let it happen again.',
    ],
  },
  {
    id: 'pdlg-advice',
    question: 'What does the woman recommend?',
    answer: '建议早点起床',
    sents: [
      'W: You should {V1@do} up {R1@really} early tomorrow.',
      'M: Why? The test is not until noon.',
      'W: The {N1@road} is crowded in the morning.',
      'M: I see. I will set the alarm tonight.',
    ],
  },
];

/**
 * PRETCO 应用文素材（写作题，F3 要求 200+）。
 *
 * 与考研写作（KAOYAN_WRITING，100–200 词议论文/书信）不同，PRETCO 写的是
 * **应用文**：通知、便条、启事、建议信、求职信等，60–100 词，格式与称谓固定。
 * 这里按 PRETCO-A 真实考过的八类文体重写 30×N 条（题材 × 情境两维组合），
 * 每条 prompt 自带具体情境，避免模板化雷同。
 */
export const PRETCO_WRITING = (() => {
  const out = [];
  const push = (genre, prompt, min = 60, max = 100) => out.push({ genre, prompt, min, max });

  /* 1) 通知 Notice：布告栏口吻，含时间/地点/对象/联系方式 */
  const noticeTopics = [
    ['英语角活动', '你校英语社团将举办「English Corner」活动，请以社团名义写一则通知，说明时间、地点、面向对象与报名方式。'],
    ['图书漂流', '学校图书馆将推出「图书漂流」活动，请写一则通知，说明规则：每人带两本已读过的书参与，可在留言卡上写推荐语。'],
    ['演讲比赛', '学生会将举办英文演讲比赛，请以学生会名义写一则通知，说明主题、报名截止日期与评分标准。'],
    ['义卖活动', '你班将举办义卖活动为贫困山区捐款，请写一则通知，说明时间、地点、义卖物品与捐款去向。'],
    ['春游报名', '学校将组织一次春季郊游，请写一则通知，说明目的地、出发时间、交通方式与报名截止日期。'],
    ['暑期社团招新', '学生社团联合会将开始暑期招新，请写一则通知，说明招新社团、报名方式与面试安排。'],
    ['讲座邀请', '学校将邀请外教举办「英语写作入门」讲座，请写一则通知，说明时间、地点、主讲人与参加对象。'],
    ['失物招领', '本校图书馆拾到一串钥匙和一本书，请写一则失物招领启事，说明拾获物品、时间地点与认领方式。'],
    ['设备报修', '教学楼三楼的多媒体设备出现故障，请写一则通知，说明故障情况、影响范围与预计修复时间。'],
    ['问卷调查', '学校将就学生课外阅读情况开展问卷调查，请写一则通知，说明调查目的、填写方式与截止时间。'],
  ];
  for (const [topic, prompt] of noticeTopics) push('通知', `${prompt}（主题：${topic}）`);

  /* 2) 求职信 / 求职申请：岗位 + 能力 + 联系方式 */
  const jobTopics = [
    ['英文报编辑', '你看到校报招聘英文版编辑，请写一封求职信，说明你的写作经历、语言水平与可投入的时间。'],
    ['夏令营辅导员', '你校国际夏令营招募英语辅导员，请写一封求职信，说明你的口语能力、相关经历与获奖情况。'],
    ['翻译助理', '一家出版社招聘英文翻译助理，请写一封求职信，说明你的翻译实践、词汇量与可实习的时段。'],
    ['书店店员', '你想应聘一家英文书店的兼职店员，请写一封求职信，说明你的推荐能力、阅读兴趣与可工作的时间。'],
    ['社团干事', '学生会文艺部招聘干事，请写一封求职信，说明你的组织能力、参与过的活动与职责设想。'],
    ['翻译实习', '你申请一家公司的英文客服实习岗位，请写一封求职信，说明你的语言基础、沟通经验与可实习时长。'],
    ['志愿者', '博物馆招募英文讲解志愿者，请写一封求职信，说明你的口语水平、对历史的兴趣与可服务的时间。'],
    ['写作助教', '你申请担任留学生的写作助教，请写一封求职信，说明你的成绩、方法与可投入的辅导时间。'],
    ['字幕校对', '一家影视公司招聘英文字幕校对，请写一封求职信，说明你的细致程度、词汇量与试译经验。'],
    ['教辅编辑', '出版社招聘英语教辅编辑，请写一封求职信，说明你的命题思路、教学经历与图表制作能力。'],
  ];
  for (const [role, prompt] of jobTopics) push('求职信', `你应聘${role}。${prompt}`);

  /* 3) 建议信 / 投诉信：向对方提出具体要求或建议 */
  const letterTopics = [
    ['图书馆噪音', '你常在自习时被图书馆内的说话声打扰。请写一封投诉信，说明具体情况并提出两条改进建议。'],
    ['宿舍作息', '你的室友提议把熄灯时间推迟到凌晨一点。请写信提出异议，说明理由并给出折中办法。'],
    ['食堂窗口', '你发现某个食堂窗口的饭菜价格与标价不符。请写一封投诉信，说明经过并要求澄清。'],
    ['网络速度', '你所在的宿舍楼宽带速度很慢。请写一封信给网络中心，说明情况并请其安排检修。'],
    ['空调开放', '夏天教室的空调开放时间太短。请写信给教务处，说明影响并请求延长开放时段。'],
    ['停车位', '你发现小区停车位长期被占。请写一封建议信，说明现象并提出管理的办法。'],
    ['活动时长', '你所在社团的活动常被打断，成员难以投入。请写信给负责人，说明问题并建议调整安排。'],
    ['打印费用', '图书馆打印费用偏高，影响同学使用。请写一封建议信，说明情况并提出可行的收费方案。'],
    ['课程安排', '某门选修课时间与必修课冲突。请写一封信说明问题，并请求协调安排。'],
    ['考试安排', '你发现考试座位安排不合理，影响了发挥。请写一封建议信，说明情况并提出改进办法。'],
  ];
  for (const [topic, prompt] of letterTopics) push('建议信', `${prompt}（针对：${topic}）`);

  /* 4) 便条 / 请假条 / 留言条：短格式，5–8 句 */
  const noteTopics = [
    ['请假', '你因发烧需要请一天病假。请给英语老师写一张英文请假条，说明原因与补课安排。'],
    ['早退', '你下午要去医院复查，需提前离校。请给班主任写一张英文请假条。'],
    ['代请假', '你的同学需要请半天假。请以同学的名义写一张英文便条，说明事由和联系人。'],
    ['迟到', '你在公交车上遇到故障，迟到了十五分钟。请给老师写一张英文便条说明情况。'],
    ['请假参加比赛', '你将代表学校参加英语演讲比赛，需要请一天的假。请写一张英文请假条说明安排。'],
    ['代取快递', '你的室友出差了，请你替他取快递。请写一张英文便条告知家人和快递信息。'],
    ['留言', '你的朋友来访但你不在家。请写一张英文便条说明你回来的时间。'],
    ['托人带话', '你今天要加班，无法参加晚上的活动。请写一张英文便条向朋友说明。'],
    ['会议改期', '你临时有事不能参加小组讨论。请写一张英文便条说明并提议改期。'],
    ['请假陪家人', '你的家人需要做手术，你需要请假一天陪同。请写一张英文请假条。'],
  ];
  for (const [topic, prompt] of noteTopics) push(topic === '留言' || topic === '托人带话' || topic === '代取快递' ? '便条' : '请假条', `${prompt}（场景：${topic}）`, 40, 60);

  /* 5) 启事 / 失物启事 / 转让 / 招聘启事 */
  const adTopics = [
    ['寻物', '你在操场捡到一个运动水壶，请写一则寻物启事，说明物品特征与联系方式。'],
    ['物品转让', '你毕业要离开这座城市，想转让一张健身年卡。请写一则转让启事，说明价格与联系方式。'],
    ['房屋出租', '你想出租自己家的一间次卧。请写一则招租启事，说明条件、租金与交通情况。'],
    ['兼职招聘', '你在经营的咖啡店招兼职店员。请写一则招聘启事，说明工作内容、待遇与联系方式。'],
    ['物品交换', '你想用一台旧相机换一台电子书阅读器。请写一则交换启事，说明成色与交换条件。'],
    ['拾物招领', '你在教室捡到一副眼镜。请写一则失物招领启事，说明时间地点与认领方式。'],
    ['课程代售', '你考完的复习资料已无用。请写一则转让启事说明资料内容与价格。'],
    ['宠物寻找', '你家的猫走丢了。请写一则寻宠启事，说明宠物特征与联系方式。'],
    ['场地预订', '你校篮球队要预定周末的训练场地。请写一则通知说明预订需求与联系人。'],
    ['图书交换', '你想组织一次同学间的图书交换活动。请写一则活动启事，说明规则与时间地点。'],
  ];
  for (const [topic, prompt] of adTopics) push('启事', `${prompt}（类型：${topic}）`);

  /* 6) 口语任务型短文：PRETCO 写作部分常见叙述 / 描述 */
  const oralTopics = [
    ['介绍家乡', '请用英语写一段话介绍你的家乡：地理位置、气候、一个特色景点与一种当地食物。'],
    ['介绍朋友', '请介绍你的一位朋友：他/她的性格、爱好，你们常一起做的事，以及你对他的评价。'],
    ['叙述经历', '请叙述一次难忘的经历：什么时候、在哪里、发生了什么、你学到了什么。'],
    ['描述一天', '请描述你普通的一天：从早上起床到晚上休息，按时间顺序写。'],
    ['介绍假期', '请介绍你上学期的假期：你去了哪里、做了什么、有什么收获。'],
    ['描述季节', '请描述你最喜欢的季节：天气、景物、人们的生活，以及你为什么喜欢。'],
    ['介绍兴趣', '请介绍你的一个爱好：你什么时候开始的、怎么学的、带来什么好处。'],
    ['叙述帮助', '请叙述一次你帮助别人的经历：事情经过、对方的反应、你的感受。'],
    ['介绍学校生活', '请介绍你的学校生活：一节课是什么样的、课余活动、老师的教学特点。'],
    ['描述运动', '请描述你参加过的一次体育运动：项目、过程、感受与坚持的原因。'],
  ];
  for (const [topic, prompt] of oralTopics) push('短文', `${prompt}（主题：${topic}）`);

  /* 7) 道歉信 / 感谢信 / 确认信 / 答复信 */
  const socialTopics = [
    ['失约道歉', '你答应参加朋友生日聚会却因故未能前往。请写信道歉，说明原因并提出补救办法。'],
    ['道歉', '你不小心弄坏了同学的实验报告。请写信道歉，说明经过与解决方案。'],
    ['感谢', '外教帮你修改了作文。请写信感谢他，说明具体帮助与你的收获。'],
    ['感谢', '同学在你生病时照顾了你几天。请写信感谢，说明细节与你的感激。'],
    ['确认', '你收到了活动邀请。请写一封确认信，确认参加并询问具体安排。'],
    ['答复', '社团邀请你参加活动，但你时间冲突。请写一封婉拒信，说明原因并祝活动顺利。'],
    ['祝贺', '朋友获得奖学金。请写一封信祝贺他，并谈谈你的建议与期望。'],
    ['询问', '你想了解一个培训课程。请写一封信询问报名方式、费用与课程安排。'],
    ['提醒', '你要提醒同学提交作业。请写一封邮件提醒，说明截止日期与提交方式。'],
    ['祝贺', '你的笔友顺利通过了考试。请写一封信表示祝贺并分享你的学习方法。'],
  ];
  for (const [topic, prompt] of socialTopics) push(topic.includes('道歉') ? '道歉信' : topic.includes('感谢') ? '感谢信' : '邮件', `${prompt}（类型：${topic}）`);

  /* 8) 图表 / 数据描述：PRETCO 常见的数据报告短文 */
  const chartTopics = [
    ['阅读时间', '下图是某班学生每天课外阅读时长的调查结果。请描述数据特点并给出你的建议。'],
    ['上网时长', '下图是五类人群每日上网时长的对比。请描述趋势并分析原因。'],
    ['出行方式', '下图是某市居民通勤方式的调查。请描述主要数据并说明你的看法。'],
    ['消费结构', '下图是某家庭月度支出的构成。请描述结构并指出可调整的部分。'],
    ['运动频率', '下图是学生每周运动次数的分布。请描述数据并提出改进建议。'],
    ['睡眠时长', '下图是不同年级学生的平均睡眠时间。请描述差异并分析原因。'],
    ['阅读偏好', '下图是不同题材图书的借阅量。请描述偏好差异并说明原因。'],
    ['志愿活动', '下图是学生参加志愿服务的时长统计。请描述数据并谈你的看法。'],
    ['学习方式', '下图是不同学习方式的使用比例。请描述现状并给出建议。'],
    ['饮食偏好', '下图是食堂各窗口的受欢迎程度。请描述数据并提出改进建议。'],
  ];
  for (const [topic, prompt] of chartTopics) push('图表作文', `${prompt}（数据：${topic}）`);

  /* 9) 议论文短文（观点明确 + 两点理由 + 结论） */
  const argueTopics = [
    ['在线学习', '有人认为在线学习会取代课堂。请写一篇短文说明你的观点并给出两点理由。'],
    ['手机管理', '学校是否应禁止学生在课间使用手机。请写一篇短文说明你的立场与理由。'],
    ['志愿服务', '志愿服务是否应计入大学学分。请写一篇短文讨论并给出理由。'],
    ['作业量', '小学是否应取消家庭作业。请写一篇短文讨论利弊并表明立场。'],
    ['阅读方式', '纸质书与电子书的优劣。请写一篇短文比较并说明你的选择。'],
    ['考试方式', '是否应降低考试在评价中的比重。请写一篇短文讨论并给出理由。'],
    ['志愿服务', '志愿活动应重在形式还是实质。请写一篇短文讨论并表明立场。'],
    ['语言学习', '是否应在小学阶段开设第二外语。请写一篇短文讨论并给出理由。'],
    ['课外培训', '课外培训对中学生弊大于利吗。请写一篇短文讨论并给出两点理由。'],
    ['传统节日', '传统节日在现代生活中应该被保留吗。请写一篇短文讨论并表明立场。'],
  ];
  for (const [topic, prompt] of argueTopics) push('话题作文', `${prompt}（题目：${topic}）`);

  /* 10) 便函式「我打算做…」：计划与安排类 */
  const planTopics = [
    ['春游计划', '你和同学计划周末郊游。请写一段话说明时间、地点、行程与分工。'],
    ['读书计划', '你打算用一个月读完一本书。请写一段话说明你的计划与每天的安排。'],
    ['学习方法', '请写一段话说明你准备如何提高英语写作水平。'],
    ['作息计划', '你打算调整作息时间。请写一段话说明你的具体安排与理由。'],
    ['活动策划', '你要组织一次班级活动。请写一段话说明流程、人员分工与应急预案。'],
    ['学习计划', '请写一段话说明本学期的学习目标与具体措施。'],
    ['旅行计划', '你计划暑假去一处地方旅行。请写一段话说明路线、预算与行李准备。'],
    ['复习计划', '期末前你制定了复习计划。请写一段话说明科目安排与重点。'],
    ['锻炼计划', '你打算坚持每天锻炼。请写一段话说明项目、时间与阶段目标。'],
    ['读书笔记', '请写一段话说明你如何整理读书笔记并分享给他人。'],
  ];
  for (const [topic, prompt] of planTopics) push('计划', `${prompt}（主题：${topic}）`);

  /* 11) 学校日常事务类应用文（PRETCO 高频，题材独立不复用上列） */
  const campusTopics = [
    ['选课', '选课系统开放了。请写一段话向同学介绍你选的课程与原因，并提醒选课注意事项。'],
    ['课表', '请向新生介绍本班一周的课程安排：每天上什么课、几点开始、哪里上课。'],
    ['班规', '你所在的班级要制定班规。请写一份班规草案，列出四条要求并说明理由。'],
    ['值日', '请写一份值日安排表的要求说明：每天谁负责、做什么、几点完成。'],
    ['家长会', '学校将召开家长会。请写一则通知，说明时间、地点、需要家长准备的事项。'],
    ['缴费', '学校开始收取本学期教材费。请写一则通知，说明金额、缴费方式与截止日期。'],
    ['校服', '学校统一订做冬季校服。请写一则通知，说明款式、尺码与领取方式。'],
    ['体检', '学校将组织学生体检。请写一则通知，说明项目、时间安排与注意事项。'],
    ['运动会', '校运动会即将开始。请写一则通知，说明项目、报名要求与加油口号。'],
    ['毕业照', '毕业照拍摄安排已确定。请写一则通知，说明时间、地点、着装要求与集合地点。'],
  ];
  for (const [topic, prompt] of campusTopics) push('通知', `${prompt}（事务：${topic}）`);

  /* 12) 求助 / 咨询 / 邀约类书信 */
  const inquiryTopics = [
    ['课程咨询', '你想了解一个英语培训班的课程设置。请写信咨询开班时间、班级人数与学费。'],
    ['书籍咨询', '你想向书店询问一本教材是否有货。请写信说明书名、版本与购买方式。'],
    ['住宿咨询', '你打算暑假在校外租房。请写信询问房租、水电与交通条件。'],
    ['兼职咨询', '你想了解校内的兼职岗位。请写信询问工作内容、报酬与时间要求。'],
    ['交换咨询', '你想了解交换项目的申请条件。请写信询问语言成绩、名额与费用。'],
    ['讲座咨询', '你想询问讲座的入场方式。请写信说明你的身份与是否需要预留座位。'],
    ['社团咨询', '你听说一个社团很有趣。请写信询问入社方式、活动安排与是否需要面试。'],
    ['奖学金咨询', '你想了解奖学金的评定标准。请写信咨询成绩要求与申请材料。'],
    ['教材咨询', '你想确认本学期是否更换教材。请写信向老师询问并说明你需要的信息。'],
    ['实习咨询', '你想了解实习单位的工作时间。请写信询问打卡方式、休息日与工作内容。'],
  ];
  for (const [topic, prompt] of inquiryTopics) push('咨询信', `${prompt}（事项：${topic}）`);

  /* 13) 叙事 + 观点结合（应用文式议论，介于作文与书信之间） */
  const hybridTopics = [
    ['志愿服务', '请写一段话：先描述你参加的一次志愿活动，再说明它带给你的两点收获。'],
    ['运动健身', '请写一段话：先描述一次运动经历，再说明坚持运动对你的影响。'],
    ['读书', '请写一段话：先描述一本影响你的书，再说明你从中学到的两点内容。'],
    ['合作', '请写一段话：先描述一次小组合作，再说明合作中你学到的东西。'],
    ['失败', '请写一段话：先描述一次失败的经历，再说明你从中总结的教训。'],
    ['旅行见闻', '请写一段话：先描述旅途中的一件小事，再说明它给你的启示。'],
    ['传统文化', '请写一段话：先描述一个你家乡的传统节日，再说明它今天的意义。'],
    ['网络', '请写一段话：先描述网络给你带来的一个便利，再说明你如何看待它的缺点。'],
    ['友谊', '请写一段话：先描述一段友谊的开始，再说明维持友谊的关键。'],
    ['家乡变化', '请写一段话：先描述你家乡这些年的一处变化，再说明你的感受。'],
  ];
  for (const [topic, prompt] of hybridTopics) push('短文', `${prompt}（话题：${topic}）`);

  /* 14) 情景区景应用文（购物 / 出行 / 医疗 / 用工等生活场景） */
  const lifeTopics = [
    ['购物', '你买到的商品与描述不符。请写一封退货信，说明订单信息、问题与你的诉求。'],
    ['投诉', '你在餐厅用餐后发现账单多算了一笔。请写一封投诉信说明情况并要求核对。'],
    ['看病', '你需要请医生帮忙开一份证明。请写一份申请，说明事由与就诊时间。'],
    ['改期', '你预约了今天下午的面诊但需改期。请写一封信说明原因并申请另约时间。'],
    ['租房', '你租的房屋有漏水问题。请写信给房东说明情况并提出维修要求。'],
    ['航班', '你的航班被延误六小时。请写一封信说明情况并询问后续安排。'],
    ['火车', '你错过了火车班次。请写信给铁路部门说明情况并询问改签方式。'],
    ['快递', '你的包裹延误未到。请写信给快递公司说明情况并要求核实。'],
    ['退款', '你申请退款后迟迟未收到。请写信说明情况并要求说明原因。'],
    ['投诉', '你在餐厅等位超过一小时。请写一封投诉信说明经过并提出建议。'],
    ['保险', '你想了解保险的理赔流程。请写信咨询所需材料与办理时限。'],
    ['宽带', '你想申请安装宽带。请写一封信咨询费用、时长与办理条件。'],
    ['停车', '你在商场找不到停车位。请写一张便条说明情况并询问收费处位置。'],
    ['客服', '你对客服的处理不满意。请写信说明经过并请求上级处理。'],
    ['预约', '你想预约一次参观。请写信说明人数、时间需求与联系方式。'],
    ['报名', '你想报名参加一个免费讲座。请写一封报名信说明个人信息与意愿。'],
    ['证明', '你需要请学校出具在读证明。请写一份申请说明用途与领取方式。'],
    ['推荐', '你想请朋友推荐一个可靠的租房中介。请写信说明需求并请求建议。'],
    ['遗失', '你在公交车上遗失了证件。请写一则启事说明遗失物品与补办方式。'],
    ['询问', '你收到一封看不懂的通知。请写信向相关部门询问具体含义与办理方式。'],
  ];
  for (const [topic, prompt] of lifeTopics) push(topic === '遗失' || topic === '停车' ? '启事' : '应用文', `${prompt}（场景：${topic}）`);

  /* 15) 通知：主办方 × 事项 的正交组合（15 条） */
  const noticeSubjects = [
    ['学校教务处', '期末考试安排'],
    ['学生社团联合会', '社团年度考核'],
    ['学校图书馆', '延长开放时间'],
    ['后勤服务中心', '宿舍水电检修'],
    ['校医院', '流感疫苗接种'],
    ['国际交流处', '暑期出国交流项目说明会'],
    ['就业指导中心', '秋季校园双选会'],
    ['心理健康中心', '新生心理普查'],
    ['体育部', '冬季长跑测试'],
    ['党委学生工作部', '主题班会评比'],
    ['科研处', '大创项目中期检查'],
    ['财务处', '学费缴纳与批条流程'],
    ['网络中心', '有线网停机维护'],
    ['保卫处', '夜间门禁与访客登记说明'],
    ['保卫处', '消防演练安排'],
  ];
  const noticeMails = [
    '请以主管部门名义说明事项、范围、时间安排与联系方式，并提醒同学按要求执行。',
    '请写一则通知，包含事项概述、具体安排、注意事项与咨询电话。',
    '请以公告形式告知全体相关人员：事由、实施时间、涉及对象与所需准备。',
  ];
  noticeSubjects.forEach(([org, subject], i) => {
    push('通知', `${org}拟就「${subject}」发布一则通知。${noticeMails[i % noticeMails.length]}`);
  });

  /* 16) 书信写作：写信人身份 × 诉求 的正交组合（20 条） */
  const writers = ['一名高二学生', '一名大三学生', '一名新入职的职员', '一名留学生', '一名实习教师', '一名家长'];
  const asks = [
    ['咨询课程安排', '想了解下学期的课程时间与选课办法，并说明自己已修的学分。'],
    ['申请延期提交', '因家中事务希望把作业延后两天，并承诺按时补交。'],
    ['询问收费标准', '想确认报名活动是否收费，以及退费规则。'],
    ['申请更换宿舍', '因作息差异希望调整宿舍楼层，并说明原因。'],
    ['确认实习岗位', '想确认入职日期、报到地点与所需材料。'],
    ['推荐一位学生', '想推荐一位同学参加项目，并说明他的优势。'],
  ];
  for (const w of writers) {
    for (const [askTopic, askBody] of asks) {
      push('书信', `${w}给学校（或单位）写一封信，${askBody}（诉求：${askTopic}）`, 80, 120);
    }
  }

  /* 17) 口语/书面综合：人物描写 + 场景（20 条） */
  const figures = ['一位热心的邻居', '一位严格的老师', '一位沉默的同桌', '一位爱笑的室友', '一位严谨的医生', '一位健谈的司机'];
  const scenes = [
    ['在雨天的公交车上', '你们因为一把伞而熟识，请描述这件事与你的感受。'],
    ['在一次小组作业中', '你们意见不合又最终达成一致，请描述这个过程。'],
    ['在医院的候诊室里', '你们因为一次帮忙而相识，请描述这件事。'],
    ['在一次旅行的旅途中', '你们互相帮忙解决了困难，请描述这件事。'],
    ['在一次考试之后', '你们一起复盘了错题，请描述这个过程。'],
    ['在一次志愿活动中', '你们并肩完成了任务，请描述这件事。'],
  ];
  for (const fig of figures) {
    for (const [sc, scBody] of scenes) {
      push('短文', `以「${fig}」为对象：${scBody}`, 60, 100);
    }
  }

  return out;
})();

/**
 * GRE 分析性写作（v1.10 第一批）。
 *
 * GRE 的写作只有两种题型，与四六级/考研的「应用文 + 短文」完全不同：
 *   1. **Analyze an Issue（立论文）**：给一个议题，要求表明立场并论证。
 *   2. **Analyze an Argument（驳论文）**：给一段论证，要求评估其逻辑漏洞
 *      （**不是**表达自己观点，这点最容易写错）。
 * 官方要求约 30 分钟 / 篇，词数无硬性下限但通常 400–600 词；这里按
 * 中文应试习惯给 150–250 词区间（应用内为自评，不冒充人工评分）。
 *
 * 素材为自撰议题与论证（不复制 ETS 题库原文 —— 那是受版权保护的真题）。
 */
export const GRE_WRITING = (() => {
  const out = [];
  const push = (genre, prompt, min = 150, max = 250) => out.push({ genre, prompt, min, max });

  /* 1) Analyze an Issue：议题陈述 × 论证角度 */
  const issues = [
    ['教育与竞争', '学校是否应当公布学生排名？'],
    ['科技与社会', '技术是否让人变得更孤独？'],
    ['科学与伦理', '科学研究是否应受道德审查限制？'],
    ['历史与记忆', '公共纪念碑是否应当被移除或保留？'],
    ['环境与责任', '个人行为对环境保护是否真的重要？'],
    ['艺术与资助', '政府是否应当资助不被市场接受的艺术？'],
    ['法律与宽容', '法律是否应当惩罚「无害的冒犯」？'],
    ['成功与运气', '成功更多取决于努力还是机遇？'],
    ['知识来源', '亲身经验是否比书本知识更可靠？'],
    ['全球化', '全球化是否在削弱本土文化？'],
    ['城市与乡村', '大城市是否比小城镇更适合生活？'],
    ['专家与大众', '公共政策是否应当由专家而非公众决定？'],
    ['大学教育', '大学是否应当以就业为唯一目标？'],
    ['媒体可信度', '新闻报道是否可能做到完全客观？'],
    ['个人隐私', '为了公共安全牺牲隐私是否值得？'],
    ['创新与规则', '创新是否必然需要打破规则？'],
    ['语言与思维', '语言是否会限制人能想到的东西？'],
    ['竞争与合作', '竞争是否比合作更能推动进步？'],
    ['失败的价值', '失败是否比成功更有教育意义？'],
    ['审美标准', '美是否存在客观标准？'],
  ];
  for (const [topic, question] of issues) {
    push('立论文', `【Analyze an Issue · ${topic}】${question} 请明确表明你的立场，用具体理由与例子论证，并预先回应一种可能的反对意见。`);
  }

  /* 2) Analyze an Argument：一段有待评估的论证（要求找逻辑漏洞） */
  const arguments_ = [
    ['销量与质量', '某公司称：我们的产品连续三年销量第一，因此它一定是最好的。'],
    ['调查与结论', '一项面向健身房会员的调查显示 80% 的人每周锻炼三次以上，因此该市多数居民锻炼充足。'],
    ['因果混淆', '近十年冰淇淋销量与溺水人数同步上升，因此吃冰淇淋会增加溺水风险。'],
    ['样本偏差', '我们杂志的读者反馈中 92% 支持这项政策，可见全国多数人支持它。'],
    ['类比失当', '既然一家连锁餐厅在 A 市成功，它在 B 市也一定会成功。'],
    ['以偏概全', '我认识的三个学编程的人都找到了高薪工作，所以学编程一定能高薪。'],
    ['忽略他因', '引入新系统后事故率下降，因此新系统是事故减少的原因。'],
    ['权威依赖', '某知名演员推荐这款保健品，因此它一定有效。'],
    ['时间相关', '过去五年该市图书馆借阅量下降，同时电子设备销量上升，因此电子设备导致人们不读书。'],
    ['数据陷阱', '某校升学率从 60% 升到 75%，可见教学质量大幅提升。'],
    ['幸存者偏差', '许多成功企业家都辍学创业，因此辍学有助于成功。'],
    ['定义模糊', '我们应当追求「更公平」的社会，所以这项政策必须通过。'],
    ['循环论证', '这本书是可信的，因为它里面说自己是可信的。'],
    ['平均数误导', '该公司员工平均年薪 20 万，因此这里的员工都很富有。'],
    ['诉诸传统', '这种做法沿用了几百年，所以它一定是正确的。'],
  ];
  for (const [topic, statement] of arguments_) {
    push('驳论文', `【Analyze an Argument · ${topic}】有人提出以下论证：「${statement}」请评估这段论证的逻辑：指出其依赖的未言明假设、可能的逻辑漏洞，并说明还需哪些证据才能使其成立。（注意：本题**不是**让你表达对该话题的看法。）`);
  }

  return out;
})();

