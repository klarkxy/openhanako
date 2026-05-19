/**
 * time-utils.js — 日界线 + 逻辑日期工具
 *
 * 系统全局以凌晨 4:00 为日界线（4:00 前算前一天）。
 * 日记、记忆编译、滚动摘要等模块共享此定义。
 */

export const DAY_BOUNDARY_HOUR = 4;

function resolveTimezone(raw) {
  const fallback = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const candidate = typeof raw === "string" && raw.trim() ? raw.trim() : fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return fallback;
  }
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function buildZonedDate({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const actual = zonedParts(guess, timeZone);
  const actualAsUtc = Date.UTC(
    Number(actual.year),
    Number(actual.month) - 1,
    Number(actual.day),
    Number(actual.hour),
    Number(actual.minute),
    Number(actual.second),
  );
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return new Date(guess.getTime() + (desiredAsUtc - actualAsUtc));
}

/**
 * 计算逻辑日期：4:00 前算前一天
 * @param {Date} [now]
 * @param {string} [timeZone]
 * @returns {{ logicalDate: string, rangeStart: Date, rangeEnd: Date }}
 */
export function getLogicalDay(now = new Date(), timeZone = null) {
  const base = new Date(now);
  const tz = timeZone ? resolveTimezone(timeZone) : null;

  if (!tz) {
    if (base.getHours() < DAY_BOUNDARY_HOUR) base.setDate(base.getDate() - 1);

    const yyyy = base.getFullYear();
    const mm = String(base.getMonth() + 1).padStart(2, "0");
    const dd = String(base.getDate()).padStart(2, "0");
    const logicalDate = `${yyyy}-${mm}-${dd}`;

    const rangeStart = new Date(base);
    rangeStart.setHours(DAY_BOUNDARY_HOUR, 0, 0, 0);
    const rangeEnd = new Date(rangeStart);
    rangeEnd.setDate(rangeEnd.getDate() + 1);

    return { logicalDate, rangeStart, rangeEnd };
  }

  const parts = zonedParts(base, tz);
  let year = Number(parts.year);
  let month = Number(parts.month);
  let day = Number(parts.day);
  if (Number(parts.hour) < DAY_BOUNDARY_HOUR) {
    const previous = new Date(Date.UTC(year, month - 1, day));
    previous.setUTCDate(previous.getUTCDate() - 1);
    year = previous.getUTCFullYear();
    month = previous.getUTCMonth() + 1;
    day = previous.getUTCDate();
  }
  const logicalDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const rangeStart = buildZonedDate({
    year,
    month,
    day,
    hour: DAY_BOUNDARY_HOUR,
    minute: 0,
    second: 0,
  }, tz);
  const rangeEnd = new Date(rangeStart);
  rangeEnd.setDate(rangeEnd.getDate() + 1);

  return { logicalDate, rangeStart, rangeEnd };
}
