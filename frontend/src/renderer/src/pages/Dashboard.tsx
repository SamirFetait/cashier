import { Card, Grid, Group, Loader, Paper, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function KpiCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Paper withBorder p="md" radius="md">
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
    monthly.data?.data.map((d) => ({ name: MONTHS[d.month - 1], total: d.total })) ?? [];

  return (
    <Stack>
      <Title order={2}>Dashboard</Title>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
        <KpiCard label="Today's Sales" value={summary.data ? summary.data.today_total.toFixed(2) : "—"} />
        <KpiCard label="This Month" value={summary.data ? summary.data.month_total.toFixed(2) : "—"} />
        <KpiCard label="Orders (month)" value={summary.data?.month_order_count ?? "—"} />
        <KpiCard label="Low Stock Items" value={summary.data?.low_stock_count ?? "—"} />
      </SimpleGrid>

      <Grid>
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Card withBorder radius="md" h={360}>
            <Title order={4} mb="sm">
              Monthly Sales ({monthly.data?.year ?? ""})
            </Title>
            {monthly.isLoading ? (
              <Loader />
            ) : (
              <ResponsiveContainer width="100%" height="85%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="total" fill="#4c6ef5" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Card withBorder radius="md" h={360}>
            <Title order={4} mb="sm">
              Low Stock
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
              <Text c="dimmed">All stock levels are healthy.</Text>
            )}
          </Card>
        </Grid.Col>
      </Grid>

      <Card withBorder radius="md">
        <Group justify="space-between" mb="sm">
          <Title order={4}>Recent Orders</Title>
        </Group>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>#</Table.Th>
              <Table.Th>Customer</Table.Th>
              <Table.Th>Total</Table.Th>
              <Table.Th>Cashier</Table.Th>
              <Table.Th>Date</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {recent.data?.results.slice(0, 8).map((o) => (
              <Table.Tr key={o.id}>
                <Table.Td>{o.id}</Table.Td>
                <Table.Td>{o.customer_name ?? "Walk-in"}</Table.Td>
                <Table.Td>{Number(o.total).toFixed(2)}</Table.Td>
                <Table.Td>{o.created_by_username ?? "—"}</Table.Td>
                <Table.Td>{new Date(o.created_at).toLocaleString()}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  );
}
