#!/usr/bin/env node
/**
 * 考研题库生成入口（v1.9.1 阶段 E）
 *
 *   node scripts/build-question-bank-kaoyan.mjs [--out <dir>] [--quiet]
 *
 * 输出 src/data/lexicons/kaoyan/question-bank/ 下的题型分片 + manifest，
 * 含 3 套可直接组卷的考研模拟卷。与中考/高考同一套引擎（build-exam-bank.mjs），
 * 差异全部来自 LEXICONS.kaoyan 的组卷计划（完形 20 空、阅读 5 题/篇）与
 * KAOYAN_* 素材集。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = [path.join(HERE, 'build-exam-bank.mjs'), '--lexicon', 'kaoyan', ...process.argv.slice(2)];
const r = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: path.dirname(HERE) });
process.exit(r.status == null ? 1 : r.status);
