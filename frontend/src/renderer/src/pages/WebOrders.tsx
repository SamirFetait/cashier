/**
 * Website orders, inside the cashier: the open orders in a column per stage,
 * and a search over every order. Open to every user; refunds and cancelling a
 * paid order stay with super admins (the server enforces it).
 */
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Pagination,
  Paper,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconBuildingStore, IconClock, IconRefresh, IconSearch, IconTruckDelivery } from "@tabler/icons-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import type { WebOrder, WebOrderStatus } from "../api/types";
import { ltr, useI18n } from "../i18n";
import {
  countdown,
  errorText,
  money,
  timeAgo,
  toNumber,
  useBoard,
  useNow,
  useOrderSearch,
} from "../webOrders/api";
import { OrderDrawer, STATUS_COLOR, StatusBadge } from "../webOrders/OrderDrawer";

const COLUMNS: WebOrderStatus[] = ["DEPOSIT_REVIEW", "AWAITING_DEPOSIT", "CONFIRMED", "PREPARING", "READY"];

const ALL_STATUSES: WebOrderStatus[] = [
  "AWAITING_DEPOSIT",
  "DEPOSIT_REVIEW",
  "CONFIRMED",
  "PREPARING",
  "READY",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
];

export function WebOrders() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const openId = Number(params.get("order")) || null;
  const [tab, setTab] = useState<string | null>("open");
  const board = useBoard();

  const show = (id: number | null) => setParams(id ? { order: String(id) } : {}, { replace: true });

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t.nav.webOrders}</Title>
        <Button
          variant="default"
          leftSection={<IconRefresh size={16} />}
          loading={board.isFetching && !board.isPending}
          onClick={() => void board.refetch()}
        >
          {t.webOrders.refresh}
        </Button>
      </Group>

      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="open">
            {t.webOrders.open}
            {board.data && board.data.orders.length > 0 && (
              <Badge size="sm" ms={6} variant="light">
                {board.data.orders.length}
              </Badge>
            )}
          </Tabs.Tab>
          <Tabs.Tab value="all">{t.webOrders.all}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="open">
          <BoardView onOpen={show} />
        </Tabs.Panel>
        <Tabs.Panel value="all">
          <SearchView onOpen={show} />
        </Tabs.Panel>
      </Tabs>

      <OrderDrawer id={openId} onClose={() => show(null)} />
    </Stack>
  );
}

function BoardView({ onOpen }: { onOpen: (id: number) => void }) {
  const { t } = useI18n();
  const board = useBoard();
  const now = useNow(1000);

  if (board.isPending) return <Skeleton h={320} />;
  if (board.isError && !board.data) return <Alert color="red">{errorText(board.error, t)}</Alert>;

  const { orders, summary } = board.data;
  // The server's clock decides when a hold ends, not this computer's.
  const skew = new Date(board.data.server_time).getTime() - board.dataUpdatedAt;
  const k = t.webOrders.kpi;

  return (
    <Stack>
      <SimpleGrid cols={{ base: 2, md: 5 }}>
        <Kpi label={k.ordersToday} value={String(summary.orders_today)} />
        <Kpi label={k.depositsToday} value={money(summary.deposits_today, t)} />
        <Kpi label={k.salesToday} value={money(summary.sales_today, t)} />
        <Kpi label={k.openValue} value={money(summary.open_value, t)} />
        <Kpi
          label={k.refundsDue}
          value={summary.refunds_due > 0 ? money(summary.refunds_due_amount, t) : "0"}
          alert={summary.refunds_due > 0}
        />
      </SimpleGrid>

      {orders.length === 0 && <Alert color="gray">{t.webOrders.noOrders}</Alert>}

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3, xl: 5 }} spacing="sm">
        {COLUMNS.map((status) => {
          const column = orders.filter((order) => order.status === status);
          return (
            <Paper key={status} withBorder radius="md" p="xs" bg="var(--mantine-color-default-hover)">
              <Group justify="space-between" mb="xs" px={4}>
                <Text fw={700} c={STATUS_COLOR[status]}>
                  {t.webOrders.status[status]}
                </Text>
                <Badge color={STATUS_COLOR[status]} variant="light">
                  {column.length}
                </Badge>
              </Group>
              <Stack gap="xs">
                {column.length === 0 ? (
                  <Text size="sm" c="dimmed" ta="center" py="sm">
                    {t.webOrders.empty}
                  </Text>
                ) : (
                  column.map((order) => (
                    <OrderCard key={order.id} order={order} now={now + skew} onOpen={() => onOpen(order.id)} />
                  ))
                )}
              </Stack>
            </Paper>
          );
        })}
      </SimpleGrid>
    </Stack>
  );
}

function Kpi({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <Paper withBorder radius="md" p="sm">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={700} size="lg" c={alert ? "red" : undefined}>
        {value}
      </Text>
    </Paper>
  );
}

function OrderCard({ order, now, onOpen }: { order: WebOrder; now: number; onOpen: () => void }) {
  const { t, lang } = useI18n();
  const w = t.webOrders;
  const pickup = order.fulfilment === "PICKUP";
  const paid = toNumber(order.deposit_paid);
  const remaining = order.expires_at ? new Date(order.expires_at).getTime() - now : null;

  return (
    <UnstyledButton onClick={onOpen} w="100%">
      <Card withBorder radius="md" padding="sm" shadow="xs">
        <Group justify="space-between" gap={4} wrap="nowrap">
          <Text fw={700} ff="monospace" size="sm">
            {ltr(order.code)}
          </Text>
          <Text size="xs" c="dimmed">
            {timeAgo(order.created_at, now, lang)}
          </Text>
        </Group>
        <Text fw={600} truncate>
          {order.customer_name}
        </Text>
        <Group gap={4} c="dimmed" wrap="nowrap">
          {pickup ? <IconBuildingStore size={14} /> : <IconTruckDelivery size={14} />}
          <Text size="xs">
            {pickup ? w.pickup : w.delivery} · {w.items(order.items_count)}
          </Text>
        </Group>
        <Text size="xs" c="dimmed" lineClamp={2} mt={2}>
          {order.items_summary.join("، ")}
        </Text>
        <Group justify="space-between" mt={6} gap={4}>
          <Text size="sm" fw={600}>
            {money(order.total, t)}
          </Text>
          {pickup && paid === 0 ? (
            <Badge size="sm" variant="light" color="teal">
              {w.payAtPickup}
            </Badge>
          ) : (
            <Text size="xs" c={paid > 0 ? "teal" : "orange"}>
              {paid > 0 ? w.balance : w.deposit}{" "}
              {money(paid > 0 ? order.balance_due : order.deposit_required, t)}
            </Text>
          )}
        </Group>
        {remaining !== null && (
          <Group gap={4} mt={4} c={remaining < 10 * 60_000 ? "red" : "dimmed"}>
            <IconClock size={13} />
            <Text size="xs">
              {w.expiresIn} {ltr(countdown(remaining))}
            </Text>
          </Group>
        )}
      </Card>
    </UnstyledButton>
  );
}

function SearchView({ onOpen }: { onOpen: (id: number) => void }) {
  const { t, formatDateTime } = useI18n();
  const w = t.webOrders;
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [debounced] = useDebouncedValue(query.trim(), 300);
  const result = useOrderSearch(debounced, status ?? "", page);

  return (
    <Stack>
      <Group>
        <TextInput
          placeholder={w.searchPlaceholder}
          leftSection={<IconSearch size={16} />}
          value={query}
          onChange={(e) => {
            setQuery(e.currentTarget.value);
            setPage(1);
          }}
          style={{ flex: 1 }}
          maw={460}
        />
        <Select
          placeholder={w.allStatuses}
          data={ALL_STATUSES.map((value) => ({ value, label: w.status[value] }))}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          clearable
          w={200}
        />
      </Group>

      {result.isError && <Alert color="red">{errorText(result.error, t)}</Alert>}

      <Card withBorder radius="md">
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{w.code}</Table.Th>
              <Table.Th>{w.customer}</Table.Th>
              <Table.Th>{t.common.phone}</Table.Th>
              <Table.Th>{w.placed}</Table.Th>
              <Table.Th>{t.common.status}</Table.Th>
              <Table.Th>{w.receipt}</Table.Th>
              <Table.Th ta="end">{w.total}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {result.data?.results.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={7}>
                  <Text c="dimmed" ta="center" py="md">
                    {w.none}
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
            {(result.data?.results ?? []).map((order) => (
              <Table.Tr key={order.id} style={{ cursor: "pointer" }} onClick={() => onOpen(order.id)}>
                <Table.Td ff="monospace">{ltr(order.code)}</Table.Td>
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    {order.fulfilment === "PICKUP" ? <IconBuildingStore size={14} /> : <IconTruckDelivery size={14} />}
                    {order.customer_name}
                  </Group>
                </Table.Td>
                <Table.Td>{ltr(order.phone)}</Table.Td>
                <Table.Td>{formatDateTime(order.created_at)}</Table.Td>
                <Table.Td>
                  <StatusBadge status={order.status} />
                </Table.Td>
                <Table.Td>{order.pos.receipt_number || "—"}</Table.Td>
                <Table.Td ta="end">{money(order.total, t)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      {result.data && result.data.pages > 1 && (
        <Group justify="center">
          <Pagination value={page} onChange={setPage} total={result.data.pages} />
        </Group>
      )}
    </Stack>
  );
}
