import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { useAuth } from "./auth";
import Login from "./components/Login";
import Layout from "./components/Layout";
import Tenants from "./components/Tenants";
import Extensions from "./components/Extensions";
import Phones from "./components/Phones";
import Trunks from "./components/Trunks";
import Dids from "./components/Dids";
import Cdr from "./components/Cdr";
import Dashboard from "./components/Dashboard";
import Softphone from "./components/softphone/Softphone";
import Prompts from "./components/Prompts";
import Ivrs from "./components/Ivrs";
import Flows from "./components/Flows";
import RingGroups from "./components/RingGroups";
import Queues from "./components/Queues";
import Schedules from "./components/Schedules";
import OutboundRoutes from "./components/OutboundRoutes";
import AgentPortal from "./components/AgentPortal";
import Users from "./components/Users";
import Recordings from "./components/Recordings";
import Settings from "./components/Settings";
import Notifications from "./components/Notifications";
import Billing from "./components/Billing";
import PlatformBilling from "./components/PlatformBilling";
import Wallboard from "./components/Wallboard";

function HomeRedirect() {
  const { me } = useAuth();
  if (!me) return <Navigate to="/login" replace />;
  if (me.role === "superadmin") return <Navigate to="/tenants" replace />;
  if (me.role === "agent") return <Navigate to="/me" replace />;
  return <Navigate to={`/t/${me.tenant_id}/dashboard`} replace />;
}

function RequireAuth({ children }: { children: JSX.Element }) {
  const { me, loading } = useAuth();
  if (loading) return <div className="center">Loading…</div>;
  if (!me) return <Navigate to="/login" replace />;
  return children;
}

// Guard the admin console: agents are sent to their self-service portal, and
// non-superadmins can't reach another tenant's URL.
function TenantGuard({ children }: { children: JSX.Element }) {
  const { tid } = useParams();
  const { me } = useAuth();
  if (me && me.role === "agent") return <Navigate to="/me" replace />;
  if (me && me.role !== "superadmin" && String(me.tenant_id) !== tid)
    return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<HomeRedirect />} />

      <Route
        path="/me"
        element={
          <RequireAuth>
            <Layout>
              <AgentPortal />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/me/softphone"
        element={
          <RequireAuth>
            <Layout>
              <Softphone />
            </Layout>
          </RequireAuth>
        }
      />

      <Route
        path="/tenants"
        element={
          <RequireAuth>
            <Layout>
              <Tenants />
            </Layout>
          </RequireAuth>
        }
      />

      <Route
        path="/platform-billing"
        element={
          <RequireAuth>
            <Layout>
              <PlatformBilling />
            </Layout>
          </RequireAuth>
        }
      />

      <Route
        path="/t/:tid/*"
        element={
          <RequireAuth>
            <TenantGuard>
              <Layout>
                <TenantRoutes />
              </Layout>
            </TenantGuard>
          </RequireAuth>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function TenantRoutes() {
  return (
    <Routes>
      <Route path="dashboard" element={<Dashboard />} />
      <Route path="wallboard" element={<Wallboard />} />
      <Route path="users" element={<Users />} />
      <Route path="extensions" element={<Extensions />} />
      <Route path="phones" element={<Phones />} />
      <Route path="ivrs" element={<Ivrs />} />
      <Route path="flows" element={<Flows />} />
      <Route path="ring-groups" element={<RingGroups />} />
      <Route path="queues" element={<Queues />} />
      <Route path="schedules" element={<Schedules />} />
      <Route path="prompts" element={<Prompts />} />
      <Route path="dids" element={<Dids />} />
      <Route path="outbound" element={<OutboundRoutes />} />
      <Route path="trunks" element={<Trunks />} />
      <Route path="cdr" element={<Cdr />} />
      <Route path="recordings" element={<Recordings />} />
      <Route path="notifications" element={<Notifications />} />
      <Route path="billing" element={<Billing />} />
      <Route path="settings" element={<Settings />} />
      <Route path="softphone" element={<Softphone />} />
      <Route path="*" element={<Navigate to="dashboard" replace />} />
    </Routes>
  );
}
