import {
  Badge,
  Button,
  Card,
  Grid,
  Group,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconDownload } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../api/client";

function money(v: string | number) {
  return Number(v).toFixed(2);
}

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

interface MarginReport {
  revenue: string;
  refunds: string;
  net_revenue: string;
  cost_of_goods: string;
  gross_margin: string;
  margin_percent: string;
  by_product: {
    product: string;
    units: string;
    revenue: string;
    cost: string;
    margin: string;
  }[];
}

interface CashierReport {
  cashiers: {
    cashier: string;
    sales: string;
    order_count: number;
    average_sale: string;
    voids: number;
    refunds: number;
    refund_value: string;
  }[];
}

interface HourlyReport {
  data: { hour: number; total: string; order_count: number }[];
  busiest_hour: number | null;
}

export function Reports() {
  const [from, setFrom] = useState(isoDaysAgo(29));
  const [to, setTo] = useState(isoDaysAgo(0));
  const range = `?from=${from}&to=${to}`;

  const margin = useQuery({
    queryKey: ["report", "margin", from, to],
    queryFn: async () => (await api.get<MarginReport>(`/reports/margin/${range}`)).data,
  });
  const cashiers = useQuery({
    queryKey: ["report", "cashier", from, to],
    queryFn: async () => (await api.get<CashierReport>(`/reports/by-cashier/${range}`)).data,
  });
  const hourly = useQuery({
    queryKey: ["report", "hourly", from, to],
    queryFn: async () => (await api.get<HourlyReport>(`/reports/hourly/${range}`)).data,
  });

  async function download(path: string, filename: string) {
    // Blob rather than a plain link: the export needs the auth header.
    const resp = await api.get(path, { responseType: "blob" });
    const url = URL.createObjectURL(resp.data as Blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  const peak = Math.max(...(hourly.data?.data ?? []).map((h) => Number(h.total)), 1);

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Reports</Title>
        <Group>
          <Button
            variant="light"
            leftSection={<IconDownload size={16} />}
            onClick={() => download(`/reports/export/sales.csv${range}`, `sales_${from}_${to}.csv`)}
          >
            Sales CSV
          </Button>
          <Button
            variant="light"
            leftSection={<IconDownload size={16} />}
            onClick={() => download("/reports/export/stock.csv", "stock.csv")}
          >
            Stock CSV
          </Button>
        </Group>
      </Group>

      <Group>
        <TextInput
          type="date"
          label="From"
          value={from}
          onChange={(e) => setFrom(e.currentTarget.value)}
        />
        <TextInput
          type="date"
          label="To"
          value={to}
          onChange={(e) => setTo(e.currentTarget.value)}
        />
      </Group>

      <Grid>
        {[
          { label: "Revenue", value: margin.data?.revenue },
          { label: "Refunds", value: margin.data?.refunds },
          { label: "Cost of goods", value: margin.data?.cost_of_goods },
          { label: "Gross margin", value: margin.data?.gross_margin, accent: true },
        ].map((tile) => (
          <Grid.Col key={tile.label} span={{ base: 6, md: 3 }}>
            <Card withBorder radius="md">
              <Text size="sm" c="dimmed">
                {tile.label}
              </Text>
              <Text size="xl" fw={700} c={tile.accent ? "teal" : undefined}>
                {tile.value ? money(tile.value) : "—"}
              </Text>
              {tile.accent && margin.data && (
                <Badge variant="light" color="teal">
                  {margin.data.margin_percent}%
                </Badge>
              )}
            </Card>
          </Grid.Col>
        ))}
      </Grid>

      <Tabs defaultValue="products">
        <Tabs.List>
          <Tabs.Tab value="products">By product</Tabs.Tab>
          <Tabs.Tab value="cashiers">By cashier</Tabs.Tab>
          <Tabs.Tab value="hourly">By hour</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="products" pt="md">
          <Card withBorder radius="md">
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Product</Table.Th>
                  <Table.Th ta="right">Units</Table.Th>
                  <Table.Th ta="right">Revenue</Table.Th>
                  <Table.Th ta="right">Cost</Table.Th>
                  <Table.Th ta="right">Margin</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(margin.data?.by_product ?? []).map((p) => (
                  <Table.Tr key={p.product}>
                    <Table.Td>{p.product}</Table.Td>
                    <Table.Td ta="right">{Number(p.units)}</Table.Td>
                    <Table.Td ta="right">{money(p.revenue)}</Table.Td>
                    <Table.Td ta="right">{money(p.cost)}</Table.Td>
                    <Table.Td ta="right" fw={600}>
                      {money(p.margin)}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel value="cashiers" pt="md">
          <Card withBorder radius="md">
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Cashier</Table.Th>
                  <Table.Th ta="right">Sales</Table.Th>
                  <Table.Th ta="right">Orders</Table.Th>
                  <Table.Th ta="right">Average</Table.Th>
                  <Table.Th ta="right">Voids</Table.Th>
                  <Table.Th ta="right">Refunds</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(cashiers.data?.cashiers ?? []).map((c) => (
                  <Table.Tr key={c.cashier}>
                    <Table.Td>{c.cashier}</Table.Td>
                    <Table.Td ta="right">{money(c.sales)}</Table.Td>
                    <Table.Td ta="right">{c.order_count}</Table.Td>
                    <Table.Td ta="right">{money(c.average_sale)}</Table.Td>
                    <Table.Td ta="right">
                      {c.voids > 0 ? (
                        <Badge color="orange" variant="light">
                          {c.voids}
                        </Badge>
                      ) : (
                        0
                      )}
                    </Table.Td>
                    <Table.Td ta="right">
                      {c.refunds > 0 ? (
                        <Badge color="red" variant="light">
                          {c.refunds} · {money(c.refund_value)}
                        </Badge>
                      ) : (
                        0
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel value="hourly" pt="md">
          <Card withBorder radius="md">
            <Stack gap={4}>
              {(hourly.data?.data ?? []).map((h) => (
                <Group key={h.hour} gap="sm" wrap="nowrap">
                  <Text size="sm" w={48} ta="right" c="dimmed">
                    {String(h.hour).padStart(2, "0")}:00
                  </Text>
                  {/* Simple inline bar — avoids pulling a chart lib for one view. */}
                  <div
                    style={{
                      height: 14,
                      borderRadius: 3,
                      background: "var(--mantine-color-blue-6)",
                      width: `${(Number(h.total) / peak) * 100}%`,
                      minWidth: Number(h.total) > 0 ? 3 : 0,
                    }}
                  />
                  <Text size="sm" c="dimmed">
                    {Number(h.total) > 0 ? `${money(h.total)} (${h.order_count})` : ""}
                  </Text>
                </Group>
              ))}
            </Stack>
          </Card>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
