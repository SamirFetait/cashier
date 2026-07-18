import { Center, Loader } from "@mantine/core";
import { Navigate, Route, Routes } from "react-router-dom";

import { AppLayout } from "./components/AppLayout";
import { useAuth } from "./auth/AuthContext";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { NewOrder } from "./pages/NewOrder";
import { Orders } from "./pages/Orders";
import { ShiftPage } from "./pages/ShiftPage";
import { PrinterSettings } from "./pages/PrinterSettings";
import { Reports } from "./pages/Reports";
import { Products } from "./pages/Products";
import { Customers } from "./pages/Customers";
import { Suppliers } from "./pages/Suppliers";
import { Users } from "./pages/Users";
import { HqReports } from "./pages/HqReports";

export default function App() {
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
        <Route path="/" element={<Dashboard />} />
        <Route path="/new-order" element={<NewOrder />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/shift" element={<ShiftPage />} />
        <Route path="/printer" element={<PrinterSettings />} />
        <Route path="/products" element={<Products />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/suppliers" element={<Suppliers />} />
        {isSuperadmin && <Route path="/reports" element={<Reports />} />}
        {isSuperadmin && <Route path="/hq-reports" element={<HqReports />} />}
        {isSuperadmin && <Route path="/users" element={<Users />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppLayout>
  );
}
