import { Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { AdminShell } from '@/components/AdminShell';
import { useLiveFeed } from '@/lib/useLiveFeed';

import Dashboard from '@/pages/Dashboard';
import Tickets from '@/pages/Tickets';
import Intake from '@/pages/Intake';
import SummaryPage from '@/pages/SummaryPage';
import Wall from '@/pages/Wall';

/**
 * Everything behind the password, sharing one SSE connection.
 *
 * Split into its own chunk so the public form does not carry it. The
 * Toaster lives here rather than at the app root for the same reason.
 */
export default function Admin() {
  const { tickets, stats, sessions, live, summaryTick } = useLiveFeed([], 24);
  const { pathname } = useLocation();

  // The wall is projected, so it gets the whole screen — no nav, no chrome.
  if (pathname === '/admin/wall') {
    return (
      <>
        <Wall />
        <Toaster theme="dark" position="bottom-right" />
      </>
    );
  }

  return (
    <>
      <AdminShell live={live}>
        <Routes>
          <Route
            index
            element={
              <Dashboard
                stats={stats}
                sessions={sessions}
                tickets={tickets}
                summaryTick={summaryTick}
              />
            }
          />
          <Route path="tickets" element={<Tickets />} />
          <Route path="complaints" element={<Intake />} />
          <Route path="summary" element={<SummaryPage summaryTick={summaryTick} />} />
        </Routes>
      </AdminShell>
      <Toaster theme="dark" position="bottom-right" />
    </>
  );
}
