import { Center, Loader } from "@mantine/core";
import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { AppLayout } from "./components/AppLayout";
import { TitleBar } from "./components/TitleBar";
import { UpdateNotifier } from "./components/UpdateNotifier";
import { useAuth } from "./auth/AuthContext";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { ScanSale } from "./pages/ScanSale";
import { Labels } from "./pages/Labels";
import { Orders } from "./pages/Orders";
import { WebOrders } from "./pages/WebOrders";
import { ShiftPage } from "./pages/ShiftPage";
import { PrinterSettings } from "./pages/PrinterSettings";
import { Reports } from "./pages/Reports";
import { Products } from "./pages/Products";
import { Customers } from "./pages/Customers";
import { Suppliers } from "./pages/Suppliers";
import { Users } from "./pages/Users";
import { HqReports } from "./pages/HqReports";

export default function App() {
  return (
    <>
      {/* On every screen, signed in or not: it is what moves and closes the window. */}
      <TitleBar />
      <UpdateNotifier />
      <Screens />
    </>
  );
}

function Screens(): ReactNode {
  const { user, loading, isSuperadmin } = useAuth();

  if (loading) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }

  if (!user) return <Login />;

  return (
    <AppLayout>
      <Routes>
        {/* A cashier starts on the till; the dashboard is for super admins. */}
        <Route path="/" element={isSuperadmin ? <Dashboard /> : <Navigate to="/scan" replace />} />
        <Route path="/scan" element={<ScanSale />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/web-orders" element={<WebOrders />} />
        <Route path="/shift" element={<ShiftPage />} />
        {isSuperadmin && <Route path="/printer" element={<PrinterSettings />} />}
        {isSuperadmin && <Route path="/products" element={<Products />} />}
        {isSuperadmin && <Route path="/labels" element={<Labels />} />}
        {isSuperadmin && <Route path="/customers" element={<Customers />} />}
        {isSuperadmin && <Route path="/suppliers" element={<Suppliers />} />}
        {isSuperadmin && <Route path="/reports" element={<Reports />} />}
        {isSuperadmin && <Route path="/hq-reports" element={<HqReports />} />}
        {isSuperadmin && <Route path="/users" element={<Users />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppLayout>
  );
}
