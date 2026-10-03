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
};

export default QingciServices;
export { QingciServices };
