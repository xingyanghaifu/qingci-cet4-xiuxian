/**
 * 应用版本号（构建时由 esbuild `define` 注入）
 *
 * 未注入时（例如在 Node 测试里直接打包源码）回退为 'dev'，
 * 用 `typeof` 判断可避免未声明标识符在运行时抛错。
 */
declare const __APP_VERSION__: string;

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
