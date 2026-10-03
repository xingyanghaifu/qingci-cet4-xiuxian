/**
 * src/ 侧服务的统一出口
 *
 * 构建时由 esbuild 打包为 IIFE 并内联进单文件 HTML（见 scripts/build.mjs），
 * 挂载为全局 `QingciServices`，供应用内联脚本按需调用；
 * 未使用该全局时应用行为与旧版完全一致。
 */
import { FEATURES, activeFeatures, isFeatureEnabled } from '../config/features';
import { gradeSubmission, GRADE_API_PATH, GRADE_TIMEOUT_MS, MIN_ANSWER_LENGTH, isValidGradeResult } from '../services/grading';
import {
  GRADE_DIMENSION_WEIGHTS,
  GRADE_VERSION,
  GRADING_PLACEHOLDER_MESSAGE,
  emptyGradeRecord,
} from '../types/grading';

const QingciServices = {
  version: '1.0.0',
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
};

export default QingciServices;
export { QingciServices };
