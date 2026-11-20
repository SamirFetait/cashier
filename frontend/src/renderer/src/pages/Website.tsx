/**
 * The website, inside the cashier, for super admins: everything the orders
 * admin (orders.fatheetkheer.com) does, under one sidebar tab with the same
 * pages in its own navbar.
 */
import { Box, Button, Group, Stack } from "@mantine/core";
import {
  IconBuildingStore,
  IconCalendarEvent,
  IconExternalLink,
  IconLayoutGrid,
  IconListSearch,
  IconMovie,
  IconRefresh,
  IconRepeat,
  IconSettings,
} from "@tabler/icons-react";
import { Link, Navigate, Route, Routes, useLocation, useSearchParams } from "react-router-dom";

import { useI18n } from "../i18n";
import { useBoard } from "../webOrders/api";
import { OrderDrawer } from "../webOrders/OrderDrawer";
import { siteLink, useSiteUrl } from "../website/api";
import { CataloguePage } from "../website/CataloguePage";
import { EventsPage } from "../website/EventsPage";
import { SettingsPage } from "../website/SettingsPage";
import { SwapsPage } from "../website/SwapsPage";
import { PageHead } from "../website/ui";
import { VideosPage } from "../website/VideosPage";
import { BoardView, SearchView } from "./WebOrders";

const PAGES = [
  { path: "", key: "board", icon: IconLayoutGrid },
  { path: "orders", key: "orders", icon: IconListSearch },
  { path: "catalogue", key: "catalogue", icon: IconBuildingStore },
  { path: "videos", key: "videos", icon: IconMovie },
  { path: "events", key: "events", icon: IconCalendarEvent },
  { path: "swaps", key: "swaps", icon: IconRepeat },
  { path: "settings", key: "settings", icon: IconSettings },
] as const;

export function Website() {
  const [params, setParams] = useSearchParams();
  const openId = Number(params.get("order")) || null;
  const show = (id: number | null) => setParams(id ? { order: String(id) } : {}, { replace: true });

  return (
    <Stack>
      <WebsiteNav />
      <Routes>
        <Route index element={<BoardPage onOpen={show} />} />
        <Route path="orders" element={<OrdersPage onOpen={show} />} />
        <Route path="catalogue" element={<CataloguePage />} />
        <Route path="videos" element={<VideosPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="swaps" element={<SwapsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/website" replace />} />
      </Routes>
      <OrderDrawer id={openId} onClose={() => show(null)} />
    </Stack>
  );
}

/** Pills a little tighter than Mantine's, so the whole bar fits one row in
 * the window's default 1280px width, scrollbar and all, in both languages. */
const PILL = { px: 10, styles: { section: { marginInlineEnd: 6 } } } as const;

/** The orders admin's top bar: its pages as pills, the open one in gold. */
function WebsiteNav() {
  const { t, lang } = useI18n();
  const site = useSiteUrl();
  const here = useLocation().pathname.replace(/^\/website\/?/, "").split("/")[0];

  return (
    <Box
      component="nav"
      aria-label={t.nav.website}
      bg="teal.9"
      p={6}
      style={{ borderRadius: "var(--mantine-radius-lg)" }}
    >
      <Group gap={4}>
        {PAGES.map((page) => {
          const active = here === page.path;
          const Icon = page.icon;
          return (
            <Button
              key={page.key}
              component={Link}
              to={page.path ? `/website/${page.path}` : "/website"}
              radius="xl"
              variant={active ? "filled" : "subtle"}
              color={active ? "gold.4" : "gray.0"}
              autoContrast
              leftSection={<Icon size={16} />}
              aria-current={active ? "page" : undefined}
              {...PILL}
            >
              {t.website.nav[page.key]}
            </Button>
          );
        })}
        <Button
          component="a"
          href={site ? siteLink(site, { kind: "home" }, lang) : undefined}
          target="_blank"
          rel="noreferrer"
          ms="auto"
          radius="xl"
          variant="subtle"
          color="gray.0"
          disabled={!site}
          leftSection={<IconExternalLink size={16} />}
          {...PILL}
        >
          {t.website.openSite}
        </Button>
      </Group>
    </Box>
  );
}

function BoardPage({ onOpen }: { onOpen: (id: number) => void }) {
  const { t } = useI18n();
  const board = useBoard();
  return (
    <>
      <PageHead title={t.website.nav.board} intro={t.website.boardIntro}>
        <Button
          variant="default"
          leftSection={<IconRefresh size={16} />}
          loading={board.isFetching && !board.isPending}
          onClick={() => void board.refetch()}
        >
          {t.webOrders.refresh}
        </Button>
      </PageHead>
      <BoardView onOpen={onOpen} />
    </>
  );
}

function OrdersPage({ onOpen }: { onOpen: (id: number) => void }) {
  const { t } = useI18n();
  return (
    <>
      <PageHead title={t.website.nav.orders} intro={t.website.ordersIntro} />
      <SearchView onOpen={onOpen} />
    </>
  );
}
