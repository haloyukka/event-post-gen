// 日本の祝日判定（内閣府の祝日法に基づく計算。2020年以降を想定）
const pad = (n) => String(n).padStart(2, "0");
const key = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

function nthMonday(y, m, n) {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0=日
  const offset = (8 - first) % 7; // 最初の月曜までの日数
  return 1 + offset + (n - 1) * 7;
}

function equinox(y, base) {
  return Math.floor(base + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
}

const cache = new Map();

function baseHolidays(y) {
  const s = new Set([
    key(y, 1, 1), key(y, 2, 11), key(y, 2, 23), key(y, 4, 29), key(y, 5, 3),
    key(y, 5, 4), key(y, 5, 5), key(y, 8, 11), key(y, 11, 3), key(y, 11, 23),
    key(y, 1, nthMonday(y, 1, 2)), key(y, 7, nthMonday(y, 7, 3)),
    key(y, 9, nthMonday(y, 9, 3)), key(y, 10, nthMonday(y, 10, 2)),
    key(y, 3, equinox(y, 20.8431)), key(y, 9, equinox(y, 23.2488)),
  ]);
  return s;
}

export function holidaysOf(y) {
  if (cache.has(y)) return cache.get(y);
  const s = baseHolidays(y);
  const dates = [...s].sort();
  // 国民の休日：祝日に挟まれた平日
  for (let i = 0; i + 1 < dates.length; i++) {
    const a = new Date(dates[i] + "T00:00:00Z");
    const b = new Date(dates[i + 1] + "T00:00:00Z");
    if ((b - a) / 86400000 === 2) {
      const mid = new Date(a.getTime() + 86400000);
      if (mid.getUTCDay() !== 0) s.add(mid.toISOString().slice(0, 10));
    }
  }
  // 振替休日：日曜の祝日の後、最初の祝日でない日
  for (const d of [...s].sort()) {
    const dt = new Date(d + "T00:00:00Z");
    if (dt.getUTCDay() === 0) {
      let n = new Date(dt.getTime() + 86400000);
      while (s.has(n.toISOString().slice(0, 10))) n = new Date(n.getTime() + 86400000);
      s.add(n.toISOString().slice(0, 10));
    }
  }
  cache.set(y, s);
  return s;
}

export function isHoliday(iso) {
  return holidaysOf(Number(iso.slice(0, 4))).has(iso);
}
