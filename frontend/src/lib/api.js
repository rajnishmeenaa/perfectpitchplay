import axios from "axios";
import { toast } from "sonner";

export const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API });

// The app can be served inside a cross-origin preview iframe, where the browser
// may partition or outright block localStorage. Reads keep working but writes
// can silently disappear (or throw), which shows up as a 401 on every request
// right after a successful login. Fall back to in-memory storage so the session
// at least survives for the current page, and say so out loud.
const TOKEN_KEY = "token";
let memoryToken = null;
let storageBroken = false;

const safeGetItem = () => {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch (e) {
    storageBroken = true;
    return null;
  }
};

const safeSetItem = (value) => {
  try {
    window.localStorage.setItem(TOKEN_KEY, value);
    // A blocked/partitioned store can accept the write and then lose it.
    if (window.localStorage.getItem(TOKEN_KEY) !== value) storageBroken = true;
  } catch (e) {
    storageBroken = true;
  }
};

const safeRemoveItem = () => {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch (e) {
    storageBroken = true;
  }
};

export const setToken = (t) => {
  if (t) {
    memoryToken = t;
    safeSetItem(t);
    if (storageBroken) {
      toast.warning(
        "This browser is blocking storage for the preview, so your session lives in memory only and will be lost on refresh. Open the preview in its own tab to keep the login.",
        { duration: 12000 },
      );
    }
  } else {
    memoryToken = null;
    safeRemoveItem();
  }
};

export const getToken = () => memoryToken || safeGetItem();

export const isTokenStorageDegraded = () => storageBroken;

// Auth endpoints surface their own errors (wrong password, expired link), so
// they are left to the caller instead of triggering the global sign-out.
const isAuthEndpoint = (url = "") => url.startsWith("/auth/");

export const endSession = (message) => {
  setToken(null);
  if (message) toast.error(message, { duration: 8000 });
  if (window.location.pathname !== "/") {
    window.location.assign("/");
  }
};

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Panels fetch with `.then()` and no `.catch()`, so an expired or rejected token
// used to surface as an unhandled "Request failed with status code 401". Turn it
// into a clear sign-out instead, with a hint about what to check.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const url = error?.config?.url || "";
    if (status === 401 && !isAuthEndpoint(url)) {
      const detail = error?.response?.data?.detail;
      endSession(
        detail === "Missing token"
          ? "Your session token never reached the server. Sign in again — if it keeps happening, open /api/debug/auth in the preview to see what arrived."
          : "Your session expired. Please sign in again.",
      );
    }
    return Promise.reject(error);
  },
);
