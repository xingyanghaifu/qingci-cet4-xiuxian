#!/usr/bin/env node
/**
 * 中考题库生成入口（v1.9.0 阶段 A）
 *
 *   node scripts/build-question-bank-junior.mjs [--out <dir>] [--quiet]
 *
 * 生成 src/data/lexicons/junior/question-bank/ 下的 5 个题型分片 + manifest，
 * 含 3 套可直接组卷的中考模拟卷（各 40 题）。
 * 具体生成逻辑在 build-exam-bank.mjs（阶段 B 的高考题库复用同一套核心）。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = [path.join(HERE, 'build-exam-bank.mjs'), '--lexicon', 'junior', ...process.argv.slice(2)];
const r = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: path.dirname(HERE) });
process.exit(r.status == null ? 1 : r.status);