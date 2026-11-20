import { AppShell, Burger, Divider, Group, NavLink, ScrollArea, Text, Badge, Button } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconBarcode,
  IconLayoutDashboard,
  IconScan,
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
  IconWorld,
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
import { useWebOrderAlerts } from "../webOrders/useWebOrderAlerts";
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
  /** Not for super admins, who have the same page elsewhere. */
  cashierOnly?: boolean;
}

interface NavSection {
  /** The heading above the section; the dashboard, on top, has none. */
  title?: keyof Messages["navSections"];
  items: NavItem[];
}

// A cashier sees only what selling needs; the rest is for super admins.
const NAV: NavSection[] = [
  {
    items: [
      { to: "/", label: "dashboard", icon: <IconLayoutDashboard size={18} />, adminOnly: true },
      // The whole website, as the orders admin has it: its orders, catalogue,
      // videos, events, swaps and settings, behind a navbar of its own.
      { to: "/website", label: "website", icon: <IconWorld size={18} />, adminOnly: true },
    ],
  },
  {
    title: "selling",
    items: [
      { to: "/scan", label: "scan", icon: <IconScan size={18} /> },
      { to: "/orders", label: "orders", icon: <IconReceipt size={18} /> },
      // Cashiers work the website's orders too: they are picked up at this
      // till. Super admins find them under Website.
      { to: "/web-orders", label: "webOrders", icon: <IconWorld size={18} />, cashierOnly: true },
      { to: "/shift", label: "shift", icon: <IconCashRegister size={18} /> },
      { to: "/customers", label: "customers", icon: <IconUsers size={18} />, adminOnly: true },
    ],
  },
  {
    title: "stock",
    items: [
      { to: "/products", label: "products", icon: <IconBox size={18} />, adminOnly: true },
      { to: "/labels", label: "labels", icon: <IconBarcode size={18} />, adminOnly: true },
      { to: "/suppliers", label: "suppliers", icon: <IconTruck size={18} />, adminOnly: true },
    ],
  },
  {
    title: "reports",
    items: [
      { to: "/reports", label: "reports", icon: <IconChartBar size={18} />, adminOnly: true },
      { to: "/hq-reports", label: "hqReports", icon: <IconReportAnalytics size={18} />, adminOnly: true },
    ],
  },
  {
    title: "settings",
    items: [
      { to: "/printer", label: "printer", icon: <IconPrinter size={18} />, adminOnly: true },
      { to: "/users", label: "users", icon: <IconUserShield size={18} />, adminOnly: true },
    ],
  },
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
  // New website orders pop up on whatever screen is open.
  useWebOrderAlerts();
  // A section with nothing this user may open is left out, heading and all.
  const sections = NAV.map((section) => ({
    ...section,
    items: section.items.filter((n) => (n.adminOnly ? isSuperadmin : !(n.cashierOnly && isSuperadmin))),
  })).filter((section) => section.items.length > 0);
  // A page with pages of its own (/website/events) keeps its link lit.
  const isActive = (to: string) =>
    location.pathname === to || (to !== "/" && location.pathname.startsWith(`${to}/`));

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
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label={t.nav.menu} />
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
        {/* Small headings, and rows 4px shorter than Mantine's, so all of a
            super admin's pages fit the window's default 820px height
            without scrolling. */}
        <AppShell.Section grow component={ScrollArea}>
          {sections.map((section, index) => (
            <div key={section.title ?? "home"}>
              {section.title && (
                <Text size="xs" fw={700} c="dimmed" px="sm" pt={index === 0 ? 4 : "xs"} pb={2}>
                  {t.navSections[section.title]}
                </Text>
              )}
              {section.items.map((n) => (
                <NavLink
                  key={n.to}
                  component={RouterNavLink}
                  to={n.to}
                  label={t.nav[n.label]}
                  leftSection={n.icon}
                  active={isActive(n.to)}
                  onClick={() => opened && toggle()}
                  py={6}
                />
              ))}
            </div>
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
