import "./App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import Landing from "./pages/Landing";
import UserApp from "./pages/UserApp";
import AdminApp from "./pages/AdminApp";
import AuthCallback from "./pages/AuthCallback";
import { Toaster } from "./components/ui/sonner";

function Protected({ children, role }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-zinc-500">Loading...</div>;
  if (!user) return <Navigate to="/" replace />;
  if (role && user.role !== role) return <Navigate to={user.role === "admin" ? "/admin" : "/app"} replace />;
  return children;
}

function AppRoutes() {
  const location = useLocation();
  // Process Google OAuth return FIRST (session_id in URL fragment) before any route/auth check
  if (location.hash?.includes("session_id=")) return <AuthCallback />;
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/app" element={<Protected role="user"><UserApp /></Protected>} />
      <Route path="/admin" element={<Protected role="admin"><AdminApp /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-right" richColors />
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
