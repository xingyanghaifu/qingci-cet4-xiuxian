/**
 * 单文件 HTML 的内联服务入口
 *
 * 由 scripts/build.mjs 用 esbuild 打包为 IIFE 后内联进 index.html；
 * 打包结果无 import/export，挂载全局 `QingciServices` 供应用脚本调用。
 */
import { QingciServices } from '../services/index';

(globalThis as unknown as { QingciServices?: typeof QingciServices }).QingciServices = QingciServices;
