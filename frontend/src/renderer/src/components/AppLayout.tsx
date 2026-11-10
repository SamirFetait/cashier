import { AppShell, Burger, Divider, Group, NavLink, ScrollArea, Text, Badge, Button } from "@mantine/core";
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
import { BrandLockup } from "../brand/BrandLockup";
import { BRAND_GRADIENT } from "../brand/theme";
import { WhatsAppContact } from "../brand/WhatsAppContact";
import { useI18n, type Messages } from "../i18n";
import { LanguageToggle } from "./LanguageToggle";
import { OfflineIndicator } from "./OfflineIndicator";
import { ThemeToggle } from "./ThemeToggle";
import { titleBarOffset } from "./TitleBar";

const HEADER_HEIGHT = 56;

interface NavItem {
  to: string;
  label: keyof Messages["nav"];
  icon: ReactNode;
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { to: "/", label: "dashboard", icon: <IconLayoutDashboard size={18} /> },
  { to: "/new-order", label: "newOrder", icon: <IconShoppingCart size={18} /> },
  { to: "/orders", label: "orders", icon: <IconReceipt size={18} /> },
  { to: "/shift", label: "shift", icon: <IconCashRegister size={18} /> },
  { to: "/products", label: "products", icon: <IconBox size={18} /> },
  { to: "/customers", label: "customers", icon: <IconUsers size={18} /> },
  { to: "/suppliers", label: "suppliers", icon: <IconTruck size={18} /> },
  { to: "/printer", label: "printer", icon: <IconPrinter size={18} /> },
  { to: "/reports", label: "reports", icon: <IconChartBar size={18} />, adminOnly: true },
  { to: "/hq-reports", label: "hqReports", icon: <IconReportAnalytics size={18} />, adminOnly: true },
  { to: "/users", label: "users", icon: <IconUserShield size={18} />, adminOnly: true },
];

export function AppLayout({ children }: { children: ReactNode }) {
  const [opened, { toggle }] = useDisclosure();
  const { user, logout, isSuperadmin } = useAuth();
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const branch = useQuery({
    queryKey: ["branch"],
    queryFn: async () => (await api.get<BranchInfo>("/branch/")).data,
    staleTime: 5 * 60 * 1000,
  });

  return (
    <AppShell
      // The window's title bar (App.tsx) covers the header's top strip, so the
      // header is that much taller and the sidebar and pages start below both.
      header={{ height: HEADER_HEIGHT + titleBarOffset }}
      navbar={{ width: 240, breakpoint: "sm", collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header
        style={{
          paddingTop: titleBarOffset,
          // The logo's colour sweep as a thin rule under the header.
          borderBottom: 0,
          backgroundImage: BRAND_GRADIENT,
          backgroundSize: "100% 3px",
          backgroundPosition: "bottom",
          backgroundRepeat: "no-repeat",
        }}
      >
        <Group h={HEADER_HEIGHT} px="md" justify="space-between">
          <Group>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <BrandLockup />
            {branch.data && (
              <Badge variant="light" color="teal" leftSection={<IconBuildingStore size={12} />}>
                {branch.data.name} ({branch.data.code})
              </Badge>
            )}
          </Group>
          <Group>
            <OfflineIndicator />
            <LanguageToggle />
            <ThemeToggle />
            <Text size="sm">{user?.username}</Text>
            {/* The effective role, matching the colour (a Django superuser
                keeps role CASHIER but has full access). */}
            <Badge color={isSuperadmin ? "gold.4" : "teal"} autoContrast>
              {isSuperadmin ? t.roles.SUPERADMIN : t.roles.CASHIER}
            </Badge>
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
              label={t.nav[n.label]}
              leftSection={n.icon}
              active={location.pathname === n.to}
              onClick={() => opened && toggle()}
            />
          ))}
        </AppShell.Section>
        <AppShell.Section>
          <Divider mb="sm" />
          <Group px="xs" mb="sm">
            <WhatsAppContact />
          </Group>
          <Button
            variant="light"
            color="red"
            fullWidth
            leftSection={<IconLogout size={18} className="mantine-rotate-rtl" />}
            onClick={async () => {
              await logout();
              navigate("/");
            }}
          >
            {t.nav.logout}
          </Button>
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}
