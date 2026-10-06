#!/usr/bin/env node
/**
 * PRETCO 题库生成入口（v1.9.1 阶段 F）
 *
 *   node scripts/build-question-bank-pretco.mjs [--out <dir>] [--quiet]
 *
 * 输出 src/data/lexicons/pretco/question-bank/ 下的题型分片 + manifest，
 * 含 3 套可直接组卷的 PRETCO 模拟卷。与中考/高考/考研同一套引擎
 * （build-exam-bank.mjs），差异全部来自 LEXICONS.pretco 的组卷计划
 * （语法选择 + 听力短对话 + 英译汉 + 应用文）与 PRETCO_* 素材集。
 *
 * 词库数据复用 CET-4（`wordlist: 'template'` 哨兵，词源从模板内联读），
 * 详见 docs/probe-pretco.md 的探活结论。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = [path.join(HERE, 'build-exam-bank.mjs'), '--lexicon', 'pretco', ...process.argv.slice(2)];
const r = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: path.dirname(HERE) });
process.exit(r.status == null ? 1 : r.status);
