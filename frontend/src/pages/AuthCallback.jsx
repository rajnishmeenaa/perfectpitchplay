import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { toast } from "sonner";
import { CircleNotch, Baseball as CricketBall } from "@phosphor-icons/react";

export default function AuthCallback() {
  const navigate = useNavigate();
  const { loginWithGoogleSession } = useAuth();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const hash = window.location.hash.replace(/^#/, "");
    const sessionId = new URLSearchParams(hash).get("session_id");
    (async () => {
      if (!sessionId) {
        navigate("/", { replace: true });
        return;
      }
      try {
        await loginWithGoogleSession(sessionId);
        window.history.replaceState(null, "", window.location.pathname);
        navigate("/app", { replace: true });
      } catch (err) {
        toast.error(err?.response?.data?.detail || "Google sign-in failed");
        window.history.replaceState(null, "", window.location.pathname);
        navigate("/", { replace: true });
      }
    })();
  }, [loginWithGoogleSession, navigate]);

  return (
    <div className="min-h-screen bg-zinc-100 flex flex-col items-center justify-center gap-4" data-testid="auth-callback">
      <div className="flex items-center gap-2 font-heading font-extrabold text-xl text-zinc-950">
        <CricketBall weight="fill" className="text-turf" size={30} />
        <span>PitchPlay</span>
      </div>
      <div className="flex items-center gap-3 text-zinc-600">
        <CircleNotch size={22} className="animate-spin text-neon" />
        <span className="text-sm font-semibold">Signing you in…</span>
      </div>
    </div>
  );
}
