// Attendance credit (CLFC 2027). One rule, shared by training-days (admin view) and the duty
// randomiser (later), so both read the same numbers.
//
// Each completed week from week one builds credit toward a "virtual chore":
//   - scanned in on both Tuesday and Thursday ...................... 10%
//   - scanned in on one day only, or posted an absence ............. 5%
//   - Thursday scans after the 5:45pm count do not count for that week
//   - no scan and no absence (not accountable) ..................... credit resets to 0%
// At 100% the credit counts as a chore done for that member and resets to 0%.
// A credited chore also resets that member's wait (the randomiser reads lastCreditedWeek).
//
// Pure computeAttendanceCredit() is replayed from the stored data, so nothing is kept in a
// separate table and the result is the same whenever it is asked for.

export var CREDIT_FULL = 100;
export var CREDIT_BOTH_DAYS = 10;
export var CREDIT_PART = 5;

var TZ_OFFSET_MS = 8 * 3600 * 1000; // Perth, UTC+8, no daylight saving
var COUNT_TIME = 17 * 60 + 45; // Thursday 5:45pm

function addDays(ymd, n) {
  return new Date(Date.parse(ymd + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
}
function dowOf(ymd) {
  return new Date(ymd + "T00:00:00Z").getUTCDay();
}
export function mondayOf(ymd) {
  return addDays(ymd, -((dowOf(ymd) + 6) % 7));
}
function perthYmd(date) {
  return new Date(date.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);
}
// The Thursday count cut-off as an ISO time (Thursday 5:45pm Perth).
function thursdayCutoffIso(thu) {
  return new Date(Date.parse(thu + "T00:00:00Z") + COUNT_TIME * 60000 - TZ_OFFSET_MS).toISOString();
}
// A week is complete once its Sunday has finished (Monday + 7 days, Perth midnight).
function weekEndIso(monday) {
  return new Date(Date.parse(addDays(monday, 7) + "T00:00:00Z") - TZ_OFFSET_MS).toISOString();
}

// input: { weekOne: 'YYYY-MM-DD' | null, asOf: Date,
//          checkins: [{ session_date, member_id, scanned_at }],
//          absences: [{ session_date, member_id }] }
// returns: Map member_id -> { credit, creditedWeeks: [monday], lastCreditedWeek, weeks: [{ week, pct, credit, accountable }] }
export function computeAttendanceCredit(input) {
  var out = new Map();
  if (!input || !input.weekOne) return out;

  var checkins = input.checkins || [];
  var absences = input.absences || [];
  var asOfIso = input.asOf.toISOString();

  var scanned = new Set(); // "date|member"
  var scannedAt = new Map(); // "date|member" -> scanned_at
  checkins.forEach(function (c) {
    var key = c.session_date + "|" + c.member_id;
    scanned.add(key);
    scannedAt.set(key, c.scanned_at);
  });
  var absent = new Set(absences.map(function (a) { return a.session_date + "|" + a.member_id; }));

  var members = new Set();
  checkins.forEach(function (c) { members.add(c.member_id); });
  absences.forEach(function (a) { members.add(a.member_id); });

  // Completed weeks from week one, in order.
  var weeks = [];
  for (var m = mondayOf(input.weekOne); weekEndIso(m) <= asOfIso; m = addDays(m, 7)) {
    weeks.push(m);
  }

  if (!weeks.length) return out;

  members.forEach(function (memberId) {
    var state = { credit: 0, creditedWeeks: [], lastCreditedWeek: null, weeks: [] };
    weeks.forEach(function (monday) {
      var tue = addDays(monday, 1);
      var thu = addDays(monday, 3);
      var tueKey = tue + "|" + memberId;
      var thuKey = thu + "|" + memberId;
      var scannedTue = scanned.has(tueKey);
      // A Thursday scan after the 5:45pm count does not count for this week.
      var scannedThu = scanned.has(thuKey) && scannedAt.get(thuKey) < thursdayCutoffIso(thu);
      var posted = absent.has(tueKey) || absent.has(thuKey);
      var accountable = scannedTue || scannedThu || posted;

      if (!accountable) {
        state.credit = 0;
        state.weeks.push({ week: monday, pct: 0, credit: 0, accountable: false });
        return;
      }
      var pct = (scannedTue && scannedThu) ? CREDIT_BOTH_DAYS : CREDIT_PART;
      state.credit += pct;
      if (state.credit >= CREDIT_FULL) {
        state.creditedWeeks.push(monday);
        state.lastCreditedWeek = monday;
        state.credit = 0;
      }
      state.weeks.push({ week: monday, pct: pct, credit: state.credit, accountable: true });
    });
    out.set(memberId, state);
  });
  return out;
}

// Loads the stored data for the credit rule. db is the FLEXI binding.
export async function loadAttendanceCredit(db, asOf) {
  var setting = await db.prepare("SELECT value FROM training_settings WHERE key = 'week_one'").first();
  var weekOne = setting && setting.value ? setting.value : null;
  if (!weekOne) return computeAttendanceCredit({ weekOne: null, asOf: asOf, checkins: [], absences: [] });
  var from = mondayOf(weekOne);
  var to = perthYmd(asOf);
  var checkins = await db.prepare("SELECT session_date, member_id, scanned_at FROM training_checkins WHERE session_date >= ?1 AND session_date <= ?2")
    .bind(from, to).all();
  var absences = await db.prepare("SELECT session_date, member_id FROM training_absences WHERE session_date >= ?1 AND session_date <= ?2")
    .bind(from, to).all();
  return computeAttendanceCredit({
    weekOne: weekOne,
    asOf: asOf,
    checkins: checkins.results,
    absences: absences.results
  });
}
