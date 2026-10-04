import { App } from "@capacitor/app";
import { api } from "./api";

/**
 * In-app release check for the hand-distributed Android build.
 *
 * The APK compares its own build number (versionCode) with what the backend
 * publishes at GET /app/version, so users can tap straight to the new file
 * instead of asking you for it. On the web there is nothing to update — the
 * site is always current — so this resolves to { available: false }.
 */

export async function currentBuild() {
  try {
    const info = await App.getInfo();
    return { native: true, version: info.version || "", build: Number(info.build) || 0 };
  } catch (e) {
    return { native: false, version: "", build: 0 };
  }
}

export async function checkForUpdate() {
  const current = await currentBuild();
  if (!current.native) return { available: false, force: false, current, latest: null };
  try {
    const { data } = await api.get("/app/version");
    const newer = Number(data.version_code) > current.build;
    return { available: newer, force: newer && !!data.force_update, current, latest: data };
  } catch (e) {
    return { available: false, force: false, current, latest: null, error: true };
  }
}
