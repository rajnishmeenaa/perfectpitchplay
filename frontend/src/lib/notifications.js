import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

/**
 * Native notifications for the Sapna11 Android/iOS shell.
 *
 * These are *local* notifications scheduled on the device: reminders (team lock,
 * build-your-XI nudge) fire from the OS alarm even when the app is closed, and
 * result/approval alerts are raised the moment the app learns about them.
 * Server-initiated push (waking a phone that has not opened the app) would need
 * FCM/APNs plus a Firebase project — see README note.
 */

const SCHEDULED_KEY = "pp.notif.scheduled";
const ASKED_KEY = "pp.notif.asked";
const LOCK_LEAD_MS = 10 * 60 * 1000; // remind 10 minutes before entries close
const BUILD_LEAD_MS = 45 * 60 * 1000; // remind 45 minutes before start if no team yet

export const isNative = () => {
  try { return Capacitor.isNativePlatform(); } catch (e) { return false; }
};

const hashId = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 999991;
  return h + 7;
};

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; }
};

export async function notificationPermission({ ask = true } = {}) {
  if (!isNative()) return { native: false, granted: false };
  try {
    let status = await LocalNotifications.checkPermissions();
    if (status.display !== "granted" && ask && !localStorage.getItem(ASKED_KEY)) {
      localStorage.setItem(ASKED_KEY, "1");
      status = await LocalNotifications.requestPermissions();
    }
    return { native: true, granted: status.display === "granted" };
  } catch (e) {
    return { native: true, granted: false, error: e?.message || String(e) };
  }
}

export async function notifyNow(title, body, id) {
  if (!isNative()) return false;
  const perm = await notificationPermission({ ask: false });
  if (!perm.granted) return false;
  try {
    await LocalNotifications.schedule({
      notifications: [{
        id: id || hashId(`${title}|${body}|${Date.now()}`),
        title,
        body,
        sound: "default",
      }],
    });
    return true;
  } catch (e) {
    console.warn("notifyNow failed", e);
    return false;
  }
}

/**
 * Rebuild the device's reminder schedule from the current match list.
 * matches: rows from GET /matches (id, team_a_short, team_b_short, start_time, locked)
 * covered: { [matchId]: true } when the user already has a saved team or entry there
 */
export async function syncReminders(matches = [], covered = {}) {
  if (!isNative()) return { scheduled: 0, skipped: "not-native" };
  const perm = await notificationPermission({ ask: false });
  if (!perm.granted) return { scheduled: 0, skipped: "no-permission" };

  const previous = readJson(SCHEDULED_KEY, []);
  try {
    if (previous.length) await LocalNotifications.cancel({ notifications: previous.map((p) => ({ id: p.id })) });
  } catch (e) { /* cancelling unknown ids is not an error */ }

  const now = Date.now();
  const wanted = [];
  matches.forEach((m) => {
    const start = new Date(m.start_time).getTime();
    if (!m.start_time || isNaN(start) || m.locked) return;

    if (start - now > 60000 && start - now < 3 * 24 * 3600 * 1000) {
      const hasTeam = !!covered[m.id];
      const at = hasTeam ? start - LOCK_LEAD_MS : start - BUILD_LEAD_MS;
      if (at > now) {
        wanted.push({
          id: hashId(`${m.id}:${hasTeam ? "lock" : "build"}`),
          title: hasTeam ? "Your XI locks in 10 minutes" : "Build your fantasy team",
          body: hasTeam
            ? `${m.team_a_short} vs ${m.team_b_short} entries close soon — your team is already set.`
            : `${m.team_a_short} vs ${m.team_b_short} starts soon. Pick 11 players before the deadline.`,
          at,
        });
      }
    }
  });

  if (!wanted.length) {
    localStorage.setItem(SCHEDULED_KEY, "[]");
    return { scheduled: 0 };
  }

  try {
    await LocalNotifications.schedule({
      notifications: wanted.map((w) => ({
        id: w.id,
        title: w.title,
        body: w.body,
        scheduleAt: new Date(w.at),
        sound: "default",
        smallIcon: "ic_stat_icon_config_sample",
        largeIcon: "ic_launcher",
      })),
    });
    localStorage.setItem(SCHEDULED_KEY, JSON.stringify(wanted.map((w) => ({ id: w.id, at: w.at }))));
    return { scheduled: wanted.length };
  } catch (e) {
    console.warn("syncReminders failed", e);
    return { scheduled: 0, error: e?.message || String(e) };
  }
}

/** Raise native alerts for notifications the user has not seen yet (while the app is open). */
export async function alertNewInboxItems(items = []) {
  const seen = readJson("pp.notif.seen", []);
  const fresh = items.filter((n) => n && n.id && !seen.includes(n.id) && !n.read);
  if (!fresh.length) return 0;
  for (const n of fresh.slice(0, 3)) {
    await notifyNow(n.title || "Sapna11", n.body || "", hashId(n.id));
  }
  try {
    localStorage.setItem("pp.notif.seen", JSON.stringify([...seen, ...fresh.map((f) => f.id)].slice(-200)));
  } catch (e) { /* storage full: alerts simply repeat next time */ }
  return fresh.length;
}
