/**
 * 测试辅助：阶段 D 端点用的最小 D1 桩件（内存实现）
 *
 * 只实现 functions/api/{duel,transmission,joint-demon,sect}.ts 实际用到的语句形态；
 * 未匹配到的语句会显式抛错，避免测试桩与真实 SQL 悄悄漂移。
 *
 * 用法：
 *   const db = makeFakeD1();
 *   const ctx = { request: new Request(url, { method:'POST', body: JSON.stringify(body) }), env: { DB: db } };
 *   const res = await onRequestPost(ctx);
 * 断言辅助：db._tables() 返回五张表的内部 Map/数组。
 */

export function makeFakeD1() {
  const duels = new Map();
  const transmissions = new Map();
  const joints = new Map();
  const facilities = new Map();
  const donations = [];

  const norm = (sql) => sql.replace(/\s+/g, ' ').trim();
  const pick = (row, keys) => Object.fromEntries(keys.map((k) => [k, row[k]]));

  function exec(sql, b) {
    const s = norm(sql);

    /* ── duels ── */
    if (s.startsWith('INSERT OR IGNORE INTO duels')) {
      // bind(duelId, challengerId, opponentId, startedAt)
      if (!duels.has(String(b[0]))) {
        duels.set(String(b[0]), {
          id: String(b[0]),
          challenger_id: String(b[1]),
          opponent_id: String(b[2]),
          challenger_correct: 0, challenger_time_ms: 0,
          opponent_correct: 0, opponent_time_ms: 0,
          status: 'pending', started_at: b[3], updated_at: null, finished_at: null,
        });
      }
      return {};
    }
    if (s.startsWith('UPDATE duels SET status')) {
      // bind(status, finishedAt, id)
      const row = duels.get(String(b[2]));
      if (row) { row.status = b[0]; row.finished_at = b[1]; }
      return {};
    }
    if (s.startsWith('UPDATE duels SET')) {
      // bind(correct, timeMs, updatedAt, id)
      const m = s.match(/SET (\w+)_correct/);
      const col = m ? m[1] : 'challenger';
      const row = duels.get(String(b[3]));
      if (row) {
        row[`${col}_correct`] = Number(b[0]) || 0;
        row[`${col}_time_ms`] = Number(b[1]) || 0;
        row.updated_at = b[2];
      }
      return {};
    }
    if (s.includes('challenger_correct, challenger_time_ms')) {
      const row = duels.get(String(b[0]));
      return { row: row ? { ...row } : null };
    }
    if (s.startsWith('SELECT id, challenger_id, opponent_id, status')) {
      const row = duels.get(String(b[0]));
      return {
        row: row
          ? pick(row, ['id', 'challenger_id', 'opponent_id', 'status', 'started_at', 'finished_at'])
          : null,
      };
    }

    /* ── transmissions ── */
    if (s.startsWith('SELECT id FROM transmissions WHERE word')) {
      for (const r of transmissions.values()) if (r.word === b[0]) return { row: { id: r.id } };
      return { row: null };
    }
    if (s.includes('INTO transmissions')) {
      // bind(id, fromId, toId, word, createdAt, boostUntil) —— claimed 由 SQL 常量 0
      const [id, from_id, to_id, word, created_at, boost_until] = b;
      if (!transmissions.has(String(id))) {
        transmissions.set(String(id), {
          id: String(id), from_id, to_id, word, created_at, claimed: 0, boost_until,
        });
      }
      return {};
    }
    if (s.startsWith('UPDATE transmissions SET claimed')) {
      const row = transmissions.get(String(b[0]));
      if (row) row.claimed = 1;
      return {};
    }
    if (s.includes('WHERE to_id = ?1 OR from_id = ?1')) {
      const rows = [...transmissions.values()]
        .filter((r) => r.to_id === b[0] || r.from_id === b[0])
        .sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)))
        .slice(0, 50)
        .map((r) => ({ ...r }));
      return { rows };
    }
    if (s.includes('FROM transmissions WHERE id')) {
      const row = transmissions.get(String(b[0]));
      return { row: row ? pick(row, ['id', 'to_id', 'claimed']) : null };
    }

    /* ── joint_demons ── */
    if (s.startsWith('INSERT OR IGNORE INTO joint_demons')) {
      // bind(id, initiatorId, partnerId, startedAt)
      if (!joints.has(String(b[0]))) {
        joints.set(String(b[0]), {
          id: String(b[0]), initiator_id: String(b[1]), partner_id: String(b[2]),
          initiator_correct: 0, partner_correct: 0,
          status: 'pending', passed: 0, started_at: b[3], updated_at: null, finished_at: null,
        });
      }
      return {};
    }
    if (s.startsWith('UPDATE joint_demons SET status')) {
      // bind(status, passed, finishedAt, id)
      const row = joints.get(String(b[3]));
      if (row) { row.status = b[0]; row.passed = Number(b[1]) || 0; row.finished_at = b[2]; }
      return {};
    }
    if (s.startsWith('UPDATE joint_demons SET')) {
      // bind(correct, updatedAt, id)
      const m = s.match(/SET (\w+)_correct/);
      const col = m ? m[1] : 'initiator';
      const row = joints.get(String(b[2]));
      if (row) { row[`${col}_correct`] = Number(b[0]) || 0; row.updated_at = b[1]; }
      return {};
    }
    if (s.includes('initiator_correct, partner_correct')) {
      const row = joints.get(String(b[0]));
      return { row: row ? { ...row } : null };
    }
    if (s.startsWith('SELECT id, initiator_id, partner_id, status')) {
      const row = joints.get(String(b[0]));
      return {
        row: row
          ? pick(row, ['id', 'initiator_id', 'partner_id', 'status', 'started_at', 'finished_at'])
          : null,
      };
    }

    /* ── sect_facilities / sect_donations ── */
    if (s.includes('INTO sect_facilities')) {
      // bind(facilityId, amount) —— upsert：无则建、有则累加（服务端累计）
      const [id, amount] = b;
      const cur = facilities.get(String(id));
      if (cur) cur.progress += Number(amount) || 0;
      else facilities.set(String(id), { id: String(id), progress: Number(amount) || 0, activated_at: null });
      return {};
    }
    if (s.startsWith('UPDATE sect_facilities SET activated_at')) {
      // bind(now, facilityId)
      const row = facilities.get(String(b[1]));
      if (row && !row.activated_at) row.activated_at = b[0];
      return {};
    }
    if (s.startsWith('SELECT progress, activated_at FROM sect_facilities')) {
      const row = facilities.get(String(b[0]));
      return { row: row ? { progress: row.progress, activated_at: row.activated_at } : null };
    }
    if (s.startsWith('SELECT id, progress, activated_at FROM sect_facilities')) {
      return {
        rows: [...facilities.values()].map((r) => ({
          id: r.id, progress: r.progress, activated_at: r.activated_at,
        })),
      };
    }
    if (s.includes('COUNT(DISTINCT member_id)')) {
      return { row: { n: new Set(donations.map((d) => d.member_id)).size } };
    }
    if (s.includes('INTO sect_donations')) {
      // bind(memberId, facilityId, amount, createdAt)
      donations.push({ member_id: b[0], facility_id: b[1], amount: b[2], created_at: b[3] });
      return {};
    }

    throw new Error('fake-d1 未实现的语句: ' + s);
  }

  const db = {
    prepare(sql) {
      let binds = [];
      const stmt = {
        bind(...values) { binds = values; return stmt; },
        async first() {
          const out = exec(sql, binds);
          return out.row === undefined ? null : out.row;
        },
        async all() {
          const out = exec(sql, binds);
          return { results: out.rows || [] };
        },
        async run() { exec(sql, binds); return { success: true }; },
      };
      return stmt;
    },
  };

  /** 断言辅助：读五张表的内部状态 */
  db._tables = () => ({ duels, transmissions, joints, facilities, donations });
  return db;
}

/** 构造最小 Pages Function 上下文（POST + JSON body） */
export function makeCtx(pathname, body, db) {
  const request = new Request('https://example.pages.dev' + pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { request, env: db ? { DB: db } : {} };
}
