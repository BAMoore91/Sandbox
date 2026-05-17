import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Login } from "./pages/Login";
import { Live } from "./pages/Live";
import { Timeline } from "./pages/Timeline";
import { Events } from "./pages/Events";
import { Cameras } from "./pages/Cameras";
import { Users } from "./pages/Users";
import { Settings } from "./pages/Settings";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Live />} />
        <Route path="timeline" element={<Timeline />} />
        <Route path="events" element={<Events />} />
        <Route path="cameras" element={<Cameras />} />
        <Route
          path="users"
          element={
            <ProtectedRoute requireRole="admin">
              <Users />
            </ProtectedRoute>
          }
        />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
