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
};

export default QingciServices;
export { QingciServices };
