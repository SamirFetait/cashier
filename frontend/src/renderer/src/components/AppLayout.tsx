import { AppShell, Burger, Group, NavLink, ScrollArea, Text, Badge, Button } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconLayoutDashboard,
  IconShoppingCart,
  IconBox,
  IconUsers,
  IconTruck,
  IconUserShield,
  IconLogout,
  IconBuildingStore,
  IconReportAnalytics,
  IconReceipt,
  IconCashRegister,
  IconPrinter,
  IconChartBar,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { NavLink as RouterNavLink, useLocation, useNavigate } from "react-router-dom";

import { api } from "../api/client";
import type { BranchInfo } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ThemeToggle } from "./ThemeToggle";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: <IconLayoutDashboard size={18} /> },
  { to: "/new-order", label: "New Order", icon: <IconShoppingCart size={18} /> },
  { to: "/orders", label: "Orders", icon: <IconReceipt size={18} /> },
  { to: "/shift", label: "Shift & Drawer", icon: <IconCashRegister size={18} /> },
  { to: "/products", label: "Products & Storage", icon: <IconBox size={18} /> },
  { to: "/customers", label: "Customers", icon: <IconUsers size={18} /> },
  { to: "/suppliers", label: "Suppliers", icon: <IconTruck size={18} /> },
  { to: "/printer", label: "Receipt Printer", icon: <IconPrinter size={18} /> },
  { to: "/reports", label: "Reports", icon: <IconChartBar size={18} />, adminOnly: true },
  { to: "/hq-reports", label: "HQ Reports", icon: <IconReportAnalytics size={18} />, adminOnly: true },
  { to: "/users", label: "Users", icon: <IconUserShield size={18} />, adminOnly: true },
];

export function AppLayout({ children }: { children: ReactNode }) {
  const [opened, { toggle }] = useDisclosure();
  const { user, logout, isSuperadmin } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const branch = useQuery({
    queryKey: ["branch"],
    queryFn: async () => (await api.get<BranchInfo>("/branch/")).data,
    staleTime: 5 * 60 * 1000,
  });

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: "sm", collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Text fw={700}>Cashier POS</Text>
            {branch.data && (
              <Badge variant="light" color="teal" leftSection={<IconBuildingStore size={12} />}>
                {branch.data.name} ({branch.data.code})
              </Badge>
            )}
          </Group>
          <Group>
            <ThemeToggle />
            <Text size="sm">{user?.username}</Text>
            <Badge color={isSuperadmin ? "grape" : "blue"}>{user?.role}</Badge>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <AppShell.Section grow component={ScrollArea}>
          {NAV.filter((n) => !n.adminOnly || isSuperadmin).map((n) => (
            <NavLink
              key={n.to}
              component={RouterNavLink}
              to={n.to}
              label={n.label}
              leftSection={n.icon}
              active={location.pathname === n.to}
              onClick={() => opened && toggle()}
            />
          ))}
        </AppShell.Section>
        <AppShell.Section>
          <Button
            variant="light"
            color="red"
            fullWidth
            leftSection={<IconLogout size={18} />}
            onClick={async () => {
              await logout();
              navigate("/");
            }}
          >
            Logout
          </Button>
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}
