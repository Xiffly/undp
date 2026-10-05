import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import PrivacyConsentBanner from './components/PrivacyConsentBanner';
import { useSeo } from './seo/useSeo';
import Home from './pages/Home';
import Submit from './pages/Submit';
import Confirmation from './pages/Confirmation';
import MyQueue from './pages/MyQueue';
const MapPage = React.lazy(() => import('./pages/Map'));
const ReportDetail = React.lazy(() => import('./pages/ReportDetail'));
const PublicLogin = React.lazy(() => import('./pages/Login'));
const PublicSignup = React.lazy(() => import('./pages/Signup'));
const ForgotPassword = React.lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = React.lazy(() => import('./pages/ResetPassword'));
const Account = React.lazy(() => import('./pages/Account'));
const NewsList = React.lazy(() => import('./pages/NewsList'));
const NewsDetail = React.lazy(() => import('./pages/NewsDetail'));
const AdminLogin = React.lazy(() => import('./pages/admin/Login'));
const Dashboard = React.lazy(() => import('./pages/admin/Dashboard'));
const AdminMap = React.lazy(() => import('./pages/admin/AdminMap'));
const Reports = React.lazy(() => import('./pages/admin/Reports'));
const SitrepDetail = React.lazy(() => import('./pages/admin/SitrepDetail'));
const Export = React.lazy(() => import('./pages/admin/Export'));
const Settings = React.lazy(() => import('./pages/admin/Settings'));
const TeamManagement = React.lazy(() => import('./pages/admin/TeamManagement'));
const RegisteredUsers = React.lazy(() => import('./pages/admin/RegisteredUsers'));
const Contributors = React.lazy(() => import('./pages/admin/Contributors'));
const UsersAdmin = React.lazy(() => import('./pages/admin/UsersAdmin'));
const FormBuilder = React.lazy(() => import('./pages/admin/FormBuilder'));
const TranslationEditor = React.lazy(() => import('./pages/admin/TranslationEditor'));
const AIPanel = React.lazy(() => import('./pages/admin/AIPanel'));
const ContentManager = React.lazy(() => import('./pages/admin/ContentManager'));
const ContentPreview = React.lazy(() => import('./pages/admin/ContentPreview'));
import { useAuthStore } from './store/auth';
import { usePublicAuthStore } from './store/publicAuth';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, checked } = useAuthStore();
  if (!checked) return <div role="status">Loading session…</div>;
  if (!isAuthenticated) return <Navigate to="/admin/login" replace />;
  return <>{children}</>;
}

function PublicProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = usePublicAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar />
      <main>{children}</main>
    </div>
  );
}

function shouldIndexPath(pathname: string) {
  const blockedPrefixes = ['/admin', '/reports/'];
  const blockedExactPaths = [
    '/submit',
    '/confirmation',
    '/login',
    '/signup',
    '/forgot-password',
    '/reset-password',
    '/queue',
    '/account',
  ];

  return !blockedExactPaths.includes(pathname) && !blockedPrefixes.some((prefix) => pathname.startsWith(prefix));
}

function SeoDefaults() {
  const location = useLocation();
  const index = shouldIndexPath(location.pathname);

  useSeo({
    canonicalPath: location.pathname,
    index,
    follow: index,
  });

  return null;
}

export default function App() {
  React.useEffect(() => { void useAuthStore.getState().checkSession(); }, []);
  return (
    <>
      <SeoDefaults />
      <Routes>
        <Route path="/" element={<><Navbar /><Home /></>} />
        <Route path="/submit" element={<><Navbar /><Submit /></>} />
        <Route path="/confirmation" element={<><Navbar /><Confirmation /></>} />
        <Route path="/map" element={<div className="map-page-root"><Navbar /><MapPage /></div>} />
        <Route path="/reports/:id" element={<><Navbar /><ReportDetail /></>} />
        <Route path="/login" element={<><Navbar /><PublicLogin /></>} />
        <Route path="/signup" element={<><Navbar /><PublicSignup /></>} />
        <Route path="/forgot-password" element={<><Navbar /><ForgotPassword /></>} />
        <Route path="/reset-password" element={<><Navbar /><ResetPassword /></>} />
        <Route path="/queue" element={<><Navbar /><MyQueue /></>} />
        <Route path="/account" element={<PublicProtectedRoute><><Navbar /><Account /></></PublicProtectedRoute>} />
        <Route path="/news" element={<><Navbar /><NewsList /></>} />
        <Route path="/news/:slug" element={<><Navbar /><NewsDetail /></>} />

        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin" element={<ProtectedRoute><AdminLayout><Dashboard /></AdminLayout></ProtectedRoute>} />
        <Route path="/admin/map" element={<ProtectedRoute><AdminLayout><AdminMap /></AdminLayout></ProtectedRoute>} />
        <Route path="/admin/reports" element={<ProtectedRoute><AdminLayout><Reports /></AdminLayout></ProtectedRoute>} />
        <Route path="/admin/reports/sitreps/:id" element={<ProtectedRoute><AdminLayout><SitrepDetail /></AdminLayout></ProtectedRoute>} />
        <Route path="/admin/export" element={<ProtectedRoute><AdminLayout><Export /></AdminLayout></ProtectedRoute>} />
        <Route path="/admin/settings" element={<ProtectedRoute><AdminLayout><Settings /></AdminLayout></ProtectedRoute>} />
        <Route path="/admin/users" element={<ProtectedRoute><AdminLayout><UsersAdmin /></AdminLayout></ProtectedRoute>}>
          <Route index element={<Navigate to="/admin/users/team" replace />} />
          <Route path="team" element={<TeamManagement />} />
          <Route path="registered" element={<RegisteredUsers />} />
          <Route path="users" element={<Navigate to="/admin/users/registered" replace />} />
          <Route path="contributors" element={<Contributors />} />
        </Route>
        <Route path="/admin/team" element={<Navigate to="/admin/users/team" replace />} />
        <Route path="/admin/contributors" element={<Navigate to="/admin/users/contributors" replace />} />
        <Route path="/admin/form-builder" element={<ProtectedRoute><AdminLayout><FormBuilder /></AdminLayout></ProtectedRoute>} />
        <Route path="/admin/translations" element={<ProtectedRoute><AdminLayout><TranslationEditor /></AdminLayout></ProtectedRoute>} />
        <Route path="/admin/ai" element={<ProtectedRoute><AdminLayout><AIPanel /></AdminLayout></ProtectedRoute>} />
        <Route path="/admin/content" element={<ProtectedRoute><AdminLayout><ContentManager /></AdminLayout></ProtectedRoute>} />
        <Route path="/admin/content/preview" element={<ProtectedRoute><ContentPreview /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <PrivacyConsentBanner />
    </>
  );
}
