import { Box, Card, Grid, Group, Loader, Paper, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { api } from "../api/client";
import type { LowStockRow, MonthlySales, Order, Paginated, Summary } from "../api/types";
import { useI18n } from "../i18n";

function KpiCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  /** A brand palette (see brand/theme.ts). */
  accent: "teal" | "gold" | "wood" | "green";
}) {
  return (
    <Paper
      withBorder
      p="md"
      radius="md"
      style={{ borderTop: `3px solid var(--mantine-color-${accent}-5)` }}
    >
      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
        {label}
      </Text>
      <Text size="xl" fw={700} mt={4}>
        {value}
      </Text>
    </Paper>
  );
}

export function Dashboard() {
  const { t, dir, formatDateTime } = useI18n();
  const rtl = dir === "rtl";
  const summary = useQuery({
    queryKey: ["summary"],
    queryFn: async () => (await api.get<Summary>("/reports/summary/")).data,
  });
  const monthly = useQuery({
    queryKey: ["monthly-sales"],
    queryFn: async () => (await api.get<MonthlySales>("/reports/monthly-sales/")).data,
  });
  const lowStock = useQuery({
    queryKey: ["low-stock"],
    queryFn: async () => (await api.get<LowStockRow[]>("/reports/low-stock/")).data,
  });
  const recent = useQuery({
    queryKey: ["recent-orders"],
    queryFn: async () =>
      (await api.get<Paginated<Order>>("/orders/?ordering=-created_at")).data,
  });

  const chartData =
    monthly.data?.data.map((d) => ({ name: t.months[d.month - 1], total: d.total })) ?? [];

  return (
    <Stack>
      <Title order={2}>{t.nav.dashboard}</Title>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
        <KpiCard accent="teal" label={t.dashboard.todaysSales} value={summary.data ? summary.data.today_total.toFixed(2) : "—"} />
        <KpiCard accent="green" label={t.dashboard.thisMonth} value={summary.data ? summary.data.month_total.toFixed(2) : "—"} />
        <KpiCard accent="wood" label={t.dashboard.monthOrders} value={summary.data?.month_order_count ?? "—"} />
        <KpiCard accent="gold" label={t.dashboard.lowStockItems} value={summary.data?.low_stock_count ?? "—"} />
      </SimpleGrid>

      <Grid>
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Card withBorder radius="md" h={360}>
            <Title order={4} mb="sm">
              {t.dashboard.monthlySales(monthly.data?.year ?? "")}
            </Title>
            {monthly.isLoading ? (
              <Loader />
            ) : (
              // Always laid out left-to-right: in an RTL document SVG text
              // anchors flip and the axis labels land inside the plot. The
              // Arabic mirror comes from reversing the axes instead.
              <Box dir="ltr" h="85%">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    {/* Every month labelled: the Arabic names are long enough
                        that recharts would otherwise drop some to avoid overlap. */}
                    <XAxis dataKey="name" reversed={rtl} interval={0} tick={{ fontSize: 12 }} />
                    <YAxis orientation={rtl ? "right" : "left"} />
                    <Tooltip />
                    <Bar
                      dataKey="total"
                      name={t.common.sales}
                      fill="var(--mantine-color-teal-5)"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            )}
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Card withBorder radius="md" h={360}>
            <Title order={4} mb="sm">
              {t.dashboard.lowStock}
            </Title>
            {lowStock.data && lowStock.data.length > 0 ? (
              <Table>
                <Table.Tbody>
                  {lowStock.data.map((r) => (
                    <Table.Tr key={`${r.product}-${r.storage_name}`}>
                      <Table.Td>{r.product_name}</Table.Td>
                      <Table.Td>
                        <Text c="red" fw={600}>
                          {r.quantity}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            ) : (
              <Text c="dimmed">{t.dashboard.stockHealthy}</Text>
            )}
          </Card>
        </Grid.Col>
      </Grid>

      <Card withBorder radius="md">
        <Group justify="space-between" mb="sm">
          <Title order={4}>{t.dashboard.recentOrders}</Title>
        </Group>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>#</Table.Th>
              <Table.Th>{t.common.customer}</Table.Th>
              <Table.Th>{t.common.total}</Table.Th>
              <Table.Th>{t.common.cashier}</Table.Th>
              <Table.Th>{t.common.date}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {recent.data?.results.slice(0, 8).map((o) => (
              <Table.Tr key={o.id}>
                <Table.Td>{o.id}</Table.Td>
                <Table.Td>{o.customer_name ?? t.common.walkIn}</Table.Td>
                <Table.Td>{Number(o.total).toFixed(2)}</Table.Td>
                <Table.Td>{o.created_by_username ?? "—"}</Table.Td>
                <Table.Td>{formatDateTime(o.created_at)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  );
}
