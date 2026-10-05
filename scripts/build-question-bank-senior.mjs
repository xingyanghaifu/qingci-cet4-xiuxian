#!/usr/bin/env node
/**
 * 高考题库生成入口（v1.9.0 阶段 B）
 *
 *   node scripts/build-question-bank-senior.mjs [--out <dir>] [--quiet]
 *
 * 生成 src/data/lexicons/senior/question-bank/ 下的题型分片 + manifest，
 * 含 3 套可直接组卷的高考模拟卷。与中考题库同一套引擎（build-exam-bank.mjs），
 * 差异全部来自 exam-bank-content.mjs 的高中素材与 LEXICONS.senior 的组卷计划。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = [path.join(HERE, 'build-exam-bank.mjs'), '--lexicon', 'senior', ...process.argv.slice(2)];
const r = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: path.dirname(HERE) });
process.exit(r.status == null ? 1 : r.status);