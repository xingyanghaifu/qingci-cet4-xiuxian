/**
 * src/ 侧服务的统一出口
 *
 * 构建时由 esbuild 打包为 IIFE 并内联进单文件 HTML（见 scripts/build.mjs），
 * 挂载为全局 `QingciServices`，供应用内联脚本按需调用；
 * 未使用该全局时应用行为与旧版完全一致。
 */
import { APP_VERSION } from '../config/app-version';
import { FEATURES, activeFeatures, isFeatureEnabled } from '../config/features';
import { gradeSubmission, GRADE_API_PATH, GRADE_TIMEOUT_MS, MIN_ANSWER_LENGTH, isValidGradeResult } from './grading';
import {
  createOfflineStore,
  cacheInlineDatasets,
  summarize,
  isStale,
  countItems,
  estimateBytes,
  DATASET_KEYS,
} from './offline-store';
import { initPwa, canRegisterSw } from './pwa';
import { initTheme, applyTheme, resolveTheme, readPreference, THEME_OPTIONS } from './theme';
import { resolveShortcut } from './shortcuts';
import { bindMediaSession, setPlaybackState, supportsMediaSession } from './media-session';
import { createMistakeStore } from './mistake-store';
import { applyReview, dueQueue, forecast, mistakeTrend, describeInterval, QUALITY_BY_RATING, nextEase, nextIntervalDays } from './srs';
import { runLegacyMigration, planLegacyMigration, describeMigration, LEGACY_STATE_KEY, MIGRATION_META_KEY } from './migrate';
import { createBankService, BANK_URL, RECENT_IDS_KEY, RECENT_WINDOW } from './question-bank';
import { normalizeBank, selectPracticeSet, questionType, questionPart, seededRng } from '../types/question-bank';
import { createVocabSrsStore, planLegacyVocabMigration, rateVocabRecord, createVocabRecord } from './vocab-srs';
import { VOCAB_GRADES, VOCAB_TIERS, tierOf, tierLabel, tierCounts, wordsOfTier, gradesSource } from './vocab-grades';
import { enrichWord, splitAffixes, findConfusables, collocationsFor, editDistance, describeEnrichment } from './vocab-enrich';
import { getVocabDetail, speakWord, VOCAB_DETAIL_BASE, VOCAB_DETAIL_SCHEMA, FREE_DICT_API } from './vocab-detail';
import {
  spendSpirit, earnSpirit, getBalance, listRecentTransactions, refreshInventory,
  purchase, consumeTalisman, arrayActive, talismanCount, activePillWords, bookUnlocked,
  unlockedBookWords, priceOf, grantItem, ITEM_CATALOG, ARRAY_DURATION_MS, PILL_DURATION_MS,
} from './economy';
import {
  demonNameFrom, demonRealmOf, demonImageSlot, demonImagePrompt, hash32, clampLevel,
  upsertDemon, listDemons, getDemon, reconcileDemons, countRaidReady, beastNameFrom,
  capLevelByRealm, isOverRealmCap, DEFAULT_REALM_DEMON_CAP,
  DEMON_MIN_LEVEL, DEMON_MAX_LEVEL, DEMON_RAID_LEVEL,
} from './demons';
import {
  ENCOUNTER_POOL, rollEncounter, recordEncounter, listTodayEncounters, resolveEncounter,
  countToday, listPendingEncounters, makeEncounter, encounterDef, localDateKey as encounterDayKey,
  ENCOUNTER_DAILY_LIMIT,
} from './encounters';
import {
  loadField, plantSeed, waterField, harvest, applyWitherPenalty, isMature,
  effectiveMatureDays, streakState, fieldDayKey, CROPS as FIELD_CROPS, PLOT_COUNT,
  isPlotUnlocked as fieldPlotUnlocked, DEFAULT_PLOT_UNLOCK_BY_REALM,
} from './spirit-field';
import {
  PLOT_TOTAL, PLOT_UNLOCK_BY_REALM, DEMON_LEVEL_CAP_BY_REALM, DEMON_LEVEL_ABSOLUTE_CAP,
  REALM_ENTRY_TITLES, REALM_PRIVILEGE_LINE, REALM_TIERS, TERMINAL_DEMON_NOTE,
  cultivationChain, isPlotUnlocked, sealReason, capDemonLevel, isDemonOverCap,
  harvestTitleOf, harvestDemonSoftening,
} from './cultivation';
export type { CultivationChain } from './cultivation';
import {
  loadCave, purchaseDecoration, hasDecoration, hasSpringWater, decorationDef,
  DECORATIONS, SPRING_WATER_ID,
} from './cave';
import {
  judgeDuel, createDuel, recordDuelScore, listDuels, duelReward, simulateOpponentScore,
  applyDuelBonus, DUEL_QUESTIONS, DUEL_TIME_PER_Q, DUEL_WIN_REWARD, DUEL_TIE_REWARD,
} from './duel';
import {
  canTransmit, createTransmission, claimTransmission, listTransmissions, transmissionReward,
  boostMultiplier, transmissionId, TRANSMISSION_MIN_PROFICIENCY, TRANSMISSION_SENDER_REWARD,
  TRANSMISSION_BOOST_DAYS,
} from './transmission';
import {
  judgeJoint, createJointDemon, recordJointScore, settleJointDemon, listJointDemons,
  pickJointQuestions, jointTotal, JOINT_DEMON_EACH, JOINT_DEMON_PASS_RATE, JOINT_DEMON_REWARD,
} from './joint-demon';
import {
  loadSect, saveSect, donate, checkFacilityActivation, getFacilityBuffs, facilityDef,
  facilityPercent, FACILITY_DEFS, SECT_DONATE_PRESETS,
} from './sect-facilities';
import {
  canTribulate, pickTribulationQuestions, gradeTribulation, difficultyRangeForRealm,
  tribulationSessionYields, vocabSizeOf, createTribSession, answerPick, releaseTribLock,
  tribSessionDone, formatTribTime, tribTimerWarn, tribPickIndexFromKey, tribCorrectIndex,
  saveTribulationRecord, latestTribulationRecord, readInventorySummary, loadInventorySummary,
  TRIBULATION_TOTAL, TRIBULATION_PASS, TRIBULATION_COOLDOWN_MS, TRIBULATION_REWARD_SPIRIT,
  TRIBULATION_PENALTY, TRIBULATION_KINDS, TRIBULATION_TIME_LIMIT_MS,
  DEMON_RAID_PENALTY_RATE, DEMON_RAID_REWARD_SPIRIT, DEMON_RAID_REWARD_QI,
} from './tribulation';
import {
  loadTtsManifest, loadVoaManifest, ttsEntryOf, voaList, warmTts, pickTtsSrc, ttsEntrySync,
  isKnown, isAudioCached, downloadAudio, fileTrack, prepareTrack, armVoa, playReal,
} from './audio-sources';
import { buildVocabQuestion, buildReviewQuestions, bankIdFor } from './vocab-question';
import { planStudyLoad, adjustPlan, heatmap, describePlan, daysUntil, intensityFor, DEFAULT_EXAM_DATE } from './study-plan';
import { createReportStore, attemptFromQuestion, partOfKind } from './report-store';
import { detectWeaknesses, accuracyTrend, timingByPart, buildPaperReport, compareWithTarget, describeReport, wilsonLowerBound, kindLabel, localDateKey } from '../types/report';
import { barChart, lineChart, ringChart, heatmapGrid, CHART_CSS } from './charts';
import { recommendPractice, buildRecommendedSet, describeRecommendation, countCandidates } from './recommend';
import {
  createAssessment, applyAnswer, buildAssessmentItem, estimateAssessment, describeAssessment,
  shouldStop, nextLevel, tierForLevel, priorMastery,
  ASSESSMENT_MIN_ITEMS, ASSESSMENT_MAX_ITEMS, ASSESSMENT_LEVELS,
} from './assessment';
import { loadPlanSettings, savePlanSettings, normalizePlanSettings, daysToExam, DEFAULT_PLAN_SETTINGS, PLAN_SETTINGS_KEY } from './plan-settings';
import {
  buildTrackFromText, splitSentences, normalizeAudioMeta, segmentAt, neighborSegment, indexOfSegment,
  clampAbRange, clampRate, estimateSeconds, checkDictation, normalizeForDictation, describeSegment,
  SPEED_OPTIONS, CHARS_PER_SECOND,
} from '../types/audio';
import {
  createTtsProvider, createElementProvider, pickProvider, createIntensivePlayer,
} from './audio-provider';
import {
  submitFeedback, validateFeedback, flushFeedbackQueue, loadQueue, saveQueue, readImageFile,
  FEEDBACK_API_PATH, FEEDBACK_KINDS, FEEDBACK_LIMITS, FEEDBACK_QUEUE_KEY,
} from './feedback';
import {
  REALMS, REALM_MAX_SCORE, realmByIndex, eligibleRealmIndex, evaluateRealm, detectBreakthrough,
  describeRealm, realmTable,
} from '../types/realm';
import {
  TITLES, evaluateTitles, newlyUnlocked, titleProgress, describeTitle,
} from '../types/titles';
import {
  loadGamification, saveGamification, evaluateProgress, recordProgress, unlockedTitleDetails,
  describeBreakthrough, EMPTY_GAMIFICATION, GAMIFICATION_KEY,
} from './gamification';
import {
  createGroup, joinGroup, syncProgress, fetchBoard, leaveGroup, memberId, defaultNickname,
  savedNickname, saveNickname, validateNickname, validateGroupName, normalizeGroupCode,
  isValidGroupCode, bucketProgress, rememberGroup, lastGroup, describeMember,
  GROUP_API_PATH, GROUP_MEMBER_KEY, GROUP_NICKNAME_KEY, GROUP_LAST_KEY, MAX_MEMBERS as GROUP_MAX_MEMBERS,
} from './group';
import {
  loadA11y, saveA11y, applyA11y, initA11y, normalizeA11y, describeA11y, fontScaleLabel,
  FONT_SCALES, CONTRAST_OPTIONS, MOTION_OPTIONS, SHORTCUT_HELP, DEFAULT_A11Y, A11Y_STORAGE_KEY,
} from './a11y';
import { MISTAKE_TYPES, REVIEW_RATINGS, summarizeMistakes, mistakeId, typeFromGate, proficiencyOf } from '../types/mistakes';
import {
  GRADE_DIMENSION_WEIGHTS,
  GRADE_VERSION,
  GRADING_PLACEHOLDER_MESSAGE,
  emptyGradeRecord,
} from '../types/grading';

const QingciServices = {
  version: '1.1.0',
  appVersion: APP_VERSION,
  features: {
    all: FEATURES,
    active: activeFeatures,
    isEnabled: isFeatureEnabled,
  },
  grading: {
    gradeSubmission,
    GRADE_API_PATH,
    GRADE_TIMEOUT_MS,
    MIN_ANSWER_LENGTH,
    isValidGradeResult,
    placeholderMessage: GRADING_PLACEHOLDER_MESSAGE,
    gradeVersion: GRADE_VERSION,
    dimensionWeights: GRADE_DIMENSION_WEIGHTS,
    emptyRecord: emptyGradeRecord,
  },
  offline: {
    createStore: createOfflineStore,
    cacheInlineDatasets,
    summarize,
    isStale,
    countItems,
    estimateBytes,
    datasetKeys: DATASET_KEYS,
  },
  pwa: {
    init: initPwa,
    canRegister: canRegisterSw,
  },
  theme: {
    init: initTheme,
    apply: applyTheme,
    resolve: resolveTheme,
    read: readPreference,
    options: THEME_OPTIONS,
  },
  audioSources: {
    loadTts: loadTtsManifest,
    loadVoa: loadVoaManifest,
    ttsEntry: ttsEntryOf,
    ttsEntrySync,
    voaList,
    warmTts,
    pickTtsSrc,
    isKnown,
    isCached: isAudioCached,
    download: downloadAudio,
    fileTrack,
    prepareTrack,
    armVoa,
    playReal,
  },
  duel: {
    judge: judgeDuel,
    create: createDuel,
    record: recordDuelScore,
    list: listDuels,
    reward: duelReward,
    simulate: simulateOpponentScore,
    applyBonus: applyDuelBonus,
    QUESTIONS: DUEL_QUESTIONS,
    TIME_PER_Q: DUEL_TIME_PER_Q,
    WIN_REWARD: DUEL_WIN_REWARD,
    TIE_REWARD: DUEL_TIE_REWARD,
  },
  transmission: {
    can: canTransmit,
    create: createTransmission,
    claim: claimTransmission,
    list: listTransmissions,
    reward: transmissionReward,
    boost: boostMultiplier,
    idOf: transmissionId,
    MIN_PROFICIENCY: TRANSMISSION_MIN_PROFICIENCY,
    SENDER_REWARD: TRANSMISSION_SENDER_REWARD,
    BOOST_DAYS: TRANSMISSION_BOOST_DAYS,
  },
  joint: {
    judge: judgeJoint,
    create: createJointDemon,
    record: recordJointScore,
    settle: settleJointDemon,
    list: listJointDemons,
    pick: pickJointQuestions,
    total: jointTotal,
    EACH: JOINT_DEMON_EACH,
    PASS_RATE: JOINT_DEMON_PASS_RATE,
    REWARD: JOINT_DEMON_REWARD,
  },
  sect: {
    load: loadSect,
    save: saveSect,
    donate,
    checkActivation: checkFacilityActivation,
    buffs: getFacilityBuffs,
    def: facilityDef,
    percent: facilityPercent,
    FACILITIES: FACILITY_DEFS,
    PRESETS: SECT_DONATE_PRESETS,
  },
  field: {
    load: loadField,
    plant: plantSeed,
    water: waterField,
    harvest,
    wither: applyWitherPenalty,
    isMature,
    effectiveDays: effectiveMatureDays,
    streakState,
    dayKey: fieldDayKey,
    crops: FIELD_CROPS,
    PLOTS: PLOT_COUNT,
    isUnlocked: fieldPlotUnlocked,
    UNLOCK_BY_REALM: DEFAULT_PLOT_UNLOCK_BY_REALM,
  },
  cave: {
    load: loadCave,
    purchase: purchaseDecoration,
    has: hasDecoration,
    hasSpring: hasSpringWater,
    def: decorationDef,
    decorations: DECORATIONS,
    SPRING_WATER: SPRING_WATER_ID,
  },
  demons: {
    nameFrom: demonNameFrom,
    realmOf: demonRealmOf,
    imageSlot: demonImageSlot,
    imagePrompt: demonImagePrompt,
    hash: hash32,
    clampLevel,
    capByRealm: capLevelByRealm,
    overCap: isOverRealmCap,
    REALM_CAP: DEFAULT_REALM_DEMON_CAP,
    upsert: upsertDemon,
    list: listDemons,
    get: getDemon,
    reconcile: reconcileDemons,
    raidReady: countRaidReady,
    beastNameFrom,
    MIN_LEVEL: DEMON_MIN_LEVEL,
    MAX_LEVEL: DEMON_MAX_LEVEL,
    RAID_LEVEL: DEMON_RAID_LEVEL,
  },
  /* v1.8.1 谕令四：境界↔称号↔灵田↔心魔 四环链（纯常量 + 纯函数，无副作用） */
  cultivation: {
    chain: cultivationChain,
    isPlotUnlocked,
    sealReason,
    capDemonLevel,
    isDemonOverCap,
    harvestTitleOf,
    harvestDemonSoftening,
    PLOT_TOTAL,
    PLOT_UNLOCK_BY_REALM,
    DEMON_LEVEL_CAP_BY_REALM,
    DEMON_LEVEL_ABSOLUTE_CAP,
    REALM_ENTRY_TITLES,
    REALM_PRIVILEGE_LINE,
    REALM_TIERS,
    TERMINAL_DEMON_NOTE,
  },
  encounters: {
    POOL: ENCOUNTER_POOL,
    roll: rollEncounter,
    record: recordEncounter,
    listToday: listTodayEncounters,
    resolve: resolveEncounter,
    countToday,
    listPending: listPendingEncounters,
    make: makeEncounter,
    def: encounterDef,
    dayKey: encounterDayKey,
    DAILY_LIMIT: ENCOUNTER_DAILY_LIMIT,
  },
  economy: {
    spendSpirit,
    earnSpirit,
    getBalance,
    listRecentTransactions,
    refreshInventory,
    purchase,
    consumeTalisman,
    grantItem,
    arrayActive,
    talismanCount,
    activePillWords,
    bookUnlocked,
    unlockedBookWords,
    priceOf,
    catalog: ITEM_CATALOG,
    ARRAY_MS: ARRAY_DURATION_MS,
    PILL_MS: PILL_DURATION_MS,
  },
  tribulation: {
    canTribulate,
    pick: pickTribulationQuestions,
    grade: gradeTribulation,
    range: difficultyRangeForRealm,
    yields: tribulationSessionYields,
    vocabSizeOf,
    createSession: createTribSession,
    answerPick,
    releaseLock: releaseTribLock,
    sessionDone: tribSessionDone,
    formatTime: formatTribTime,
    timerWarn: tribTimerWarn,
    pickFromKey: tribPickIndexFromKey,
    correctIndex: tribCorrectIndex,
    saveRecord: saveTribulationRecord,
    latestRecord: latestTribulationRecord,
    readInventorySummary,
    loadInventorySummary,
    TOTAL: TRIBULATION_TOTAL,
    PASS: TRIBULATION_PASS,
    COOLDOWN: TRIBULATION_COOLDOWN_MS,
    REWARD: TRIBULATION_REWARD_SPIRIT,
    RAID_PENALTY: DEMON_RAID_PENALTY_RATE,
    RAID_REWARD: DEMON_RAID_REWARD_SPIRIT,
    RAID_QI: DEMON_RAID_REWARD_QI,
    PENALTY: TRIBULATION_PENALTY,
    KINDS: TRIBULATION_KINDS,
    TIME_LIMIT: TRIBULATION_TIME_LIMIT_MS,
  },
  vocabDetail: {
    get: getVocabDetail,
    speak: speakWord,
    base: VOCAB_DETAIL_BASE,
    schema: VOCAB_DETAIL_SCHEMA,
    freeDictApi: FREE_DICT_API,
  },
  shortcuts: {
    resolve: resolveShortcut,
  },
  media: {
    bind: bindMediaSession,
    setPlaybackState,
    supported: supportsMediaSession,
  },
  mistakes: {
    createStore: createMistakeStore,
    types: MISTAKE_TYPES,
    ratings: REVIEW_RATINGS,
    summarize: summarizeMistakes,
    idOf: mistakeId,
    typeFromGate,
    proficiencyOf,
  },
  srs: {
    applyReview,
    dueQueue,
    forecast,
    trend: mistakeTrend,
    describeInterval,
    qualityByRating: QUALITY_BY_RATING,
    nextEase,
    nextIntervalDays,
  },
  migration: {
    run: runLegacyMigration,
    plan: planLegacyMigration,
    describe: describeMigration,
    legacyStateKey: LEGACY_STATE_KEY,
    markKey: MIGRATION_META_KEY,
  },
  bank: {
    createService: createBankService,
    bankUrl: BANK_URL,
    recentKey: RECENT_IDS_KEY,
    recentWindow: RECENT_WINDOW,
    normalize: normalizeBank,
    select: selectPracticeSet,
    typeOf: questionType,
    partOf: questionPart,
    rng: seededRng,
  },
  vocab: {
    createStore: createVocabSrsStore,
    planLegacyMigration: planLegacyVocabMigration,
    rateRecord: rateVocabRecord,
    createRecord: createVocabRecord,
    grades: VOCAB_GRADES,
    tiers: VOCAB_TIERS,
    tierOf,
    tierLabel,
    tierCounts,
    wordsOfTier,
    gradesSource,
    enrich: enrichWord,
    describeEnrichment,
    splitAffixes,
    confusables: findConfusables,
    collocations: collocationsFor,
    editDistance,
    buildQuestion: buildVocabQuestion,
    buildReviewQuestions,
    bankIdFor,
  },
  plan: {
    build: planStudyLoad,
    adjust: adjustPlan,
    heatmap,
    describe: describePlan,
    daysUntil,
    intensityFor,
    defaultExamDate: DEFAULT_EXAM_DATE,
  },
  report: {
    createStore: createReportStore,
    attemptFromQuestion,
    partOfKind,
    detectWeaknesses,
    trend: accuracyTrend,
    timing: timingByPart,
    buildPaperReport,
    compareWithTarget,
    describe: describeReport,
    wilsonLowerBound,
    kindLabel,
    localDateKey,
    charts: { bar: barChart, line: lineChart, ring: ringChart, heatmap: heatmapGrid },
    chartCss: CHART_CSS,
    recommend: recommendPractice,
    buildRecommendedSet,
    describeRecommendation,
    countCandidates,
  },
  assessment: {
    create: createAssessment,
    applyAnswer,
    buildItem: buildAssessmentItem,
    estimate: estimateAssessment,
    describe: describeAssessment,
    shouldStop,
    nextLevel,
    tierForLevel,
    priorMastery,
    minItems: ASSESSMENT_MIN_ITEMS,
    maxItems: ASSESSMENT_MAX_ITEMS,
    levels: ASSESSMENT_LEVELS,
  },
  settings: {
    loadPlan: loadPlanSettings,
    savePlan: savePlanSettings,
    normalizePlan: normalizePlanSettings,
    daysToExam,
    defaults: DEFAULT_PLAN_SETTINGS,
    planKey: PLAN_SETTINGS_KEY,
  },
  audio: {
    buildTrackFromText,
    splitSentences,
    normalizeMeta: normalizeAudioMeta,
    segmentAt,
    neighbor: neighborSegment,
    indexOf: indexOfSegment,
    clampAbRange,
    clampRate,
    estimateSeconds,
    checkDictation,
    normalizeForDictation,
    describeSegment,
    speedOptions: SPEED_OPTIONS,
    charsPerSecond: CHARS_PER_SECOND,
    ttsProvider: createTtsProvider,
    elementProvider: createElementProvider,
    pickProvider,
    createPlayer: createIntensivePlayer,
    /** 提供方可读名（界面展示用） */
    providerLabel(id: string): string {
      return id === 'element' ? '真实音频' : '语音合成（占位）';
    },
  },
  feedback: {
    submit: submitFeedback,
    validate: validateFeedback,
    flush: flushFeedbackQueue,
    loadQueue,
    saveQueue,
    readImageFile,
    apiPath: FEEDBACK_API_PATH,
    kinds: FEEDBACK_KINDS,
    limits: FEEDBACK_LIMITS,
    queueKey: FEEDBACK_QUEUE_KEY,
  },
  realm: {
    list: REALMS,
    maxScore: REALM_MAX_SCORE,
    byIndex: realmByIndex,
    eligibleIndex: eligibleRealmIndex,
    evaluate: evaluateRealm,
    detectBreakthrough,
    describe: describeRealm,
    table: realmTable,
  },
  titles: {
    list: TITLES,
    evaluate: evaluateTitles,
    newlyUnlocked,
    progress: titleProgress,
    describe: describeTitle,
  },
  gamification: {
    load: loadGamification,
    save: saveGamification,
    evaluate: evaluateProgress,
    record: recordProgress,
    unlockedDetails: unlockedTitleDetails,
    describeBreakthrough,
    empty: EMPTY_GAMIFICATION,
    key: GAMIFICATION_KEY,
  },
  group: {
    create: createGroup,
    join: joinGroup,
    sync: syncProgress,
    board: fetchBoard,
    leave: leaveGroup,
    memberId,
    defaultNickname,
    savedNickname,
    saveNickname,
    validateNickname,
    validateGroupName,
    normalizeCode: normalizeGroupCode,
    isValidCode: isValidGroupCode,
    bucketProgress,
    remember: rememberGroup,
    last: lastGroup,
    describeMember,
    apiPath: GROUP_API_PATH,
    memberKey: GROUP_MEMBER_KEY,
    nicknameKey: GROUP_NICKNAME_KEY,
    lastKey: GROUP_LAST_KEY,
    maxMembers: GROUP_MAX_MEMBERS,
  },
  a11y: {
    load: loadA11y,
    save: saveA11y,
    apply: applyA11y,
    init: initA11y,
    normalize: normalizeA11y,
    describe: describeA11y,
    fontScaleLabel,
    fontScales: FONT_SCALES,
    contrastOptions: CONTRAST_OPTIONS,
    motionOptions: MOTION_OPTIONS,
    shortcutHelp: SHORTCUT_HELP,
    defaults: DEFAULT_A11Y,
    key: A11Y_STORAGE_KEY,
  },
};

export default QingciServices;
export { QingciServices };
