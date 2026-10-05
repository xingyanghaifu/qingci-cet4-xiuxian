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
