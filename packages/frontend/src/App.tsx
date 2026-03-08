import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import AppLayout from '@/components/layout/AppLayout';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import Dashboard from '@/pages/Dashboard';
import Digests from '@/pages/Digests';
import DigestView from '@/pages/DigestView';
import Arcs from '@/pages/Arcs';
import ArcDetail from '@/pages/ArcDetail';
import Settings from '@/pages/Settings';
import SettingsTopics from '@/pages/SettingsTopics';
import SettingsSchedule from '@/pages/SettingsSchedule';
import SettingsPush from '@/pages/SettingsPush';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* Protected routes */}
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/digests" element={<Digests />} />
          <Route path="/digests/:id" element={<DigestView />} />
          <Route path="/arcs" element={<Arcs />} />
          <Route path="/arcs/:id" element={<ArcDetail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/topics" element={<SettingsTopics />} />
          <Route path="/settings/schedule" element={<SettingsSchedule />} />
          <Route path="/settings/push" element={<SettingsPush />} />
        </Route>

        {/* Redirect */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
