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
import { ltr, useI18n } from "../i18n";

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
  const { t } = useI18n();
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
        <Title order={2}>{t.nav.reports}</Title>
        <Group>
          <Button
            variant="light"
            leftSection={<IconDownload size={16} />}
            onClick={() => download(`/reports/export/sales.csv${range}`, `sales_${from}_${to}.csv`)}
          >
            {t.reports.salesCsv}
          </Button>
          <Button
            variant="light"
            leftSection={<IconDownload size={16} />}
            onClick={() => download("/reports/export/stock.csv", "stock.csv")}
          >
            {t.reports.stockCsv}
          </Button>
        </Group>
      </Group>

      <Group>
        <TextInput
          type="date"
          label={t.reports.from}
          value={from}
          onChange={(e) => setFrom(e.currentTarget.value)}
        />
        <TextInput
          type="date"
          label={t.reports.to}
          value={to}
          onChange={(e) => setTo(e.currentTarget.value)}
        />
      </Group>

      <Grid>
        {[
          { key: "revenue", label: t.reports.revenue, value: margin.data?.revenue },
          { key: "refunds", label: t.reports.refunds, value: margin.data?.refunds },
          { key: "cost", label: t.reports.costOfGoods, value: margin.data?.cost_of_goods },
          { key: "margin", label: t.reports.grossMargin, value: margin.data?.gross_margin, accent: true },
        ].map((tile) => (
          <Grid.Col key={tile.key} span={{ base: 6, md: 3 }}>
            <Card withBorder radius="md">
              <Text size="sm" c="dimmed">
                {tile.label}
              </Text>
              <Text size="xl" fw={700} c={tile.accent ? "teal" : undefined}>
                {tile.value ? ltr(money(tile.value)) : "—"}
              </Text>
              {tile.accent && margin.data && (
                <Badge variant="light" color="teal">
                  {ltr(`${margin.data.margin_percent}%`)}
                </Badge>
              )}
            </Card>
          </Grid.Col>
        ))}
      </Grid>

      <Tabs defaultValue="products">
        <Tabs.List>
          <Tabs.Tab value="products">{t.reports.byProduct}</Tabs.Tab>
          <Tabs.Tab value="cashiers">{t.reports.byCashier}</Tabs.Tab>
          <Tabs.Tab value="hourly">{t.reports.byHour}</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="products" pt="md">
          <Card withBorder radius="md">
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t.reports.product}</Table.Th>
                  <Table.Th ta="end">{t.reports.units}</Table.Th>
                  <Table.Th ta="end">{t.reports.revenue}</Table.Th>
                  <Table.Th ta="end">{t.common.cost}</Table.Th>
                  <Table.Th ta="end">{t.reports.margin}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(margin.data?.by_product ?? []).map((p) => (
                  <Table.Tr key={p.product}>
                    <Table.Td>{p.product}</Table.Td>
                    <Table.Td ta="end">{Number(p.units)}</Table.Td>
                    <Table.Td ta="end">{money(p.revenue)}</Table.Td>
                    <Table.Td ta="end">{money(p.cost)}</Table.Td>
                    <Table.Td ta="end" fw={600}>
                      {ltr(money(p.margin))}
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
                  <Table.Th>{t.common.cashier}</Table.Th>
                  <Table.Th ta="end">{t.common.sales}</Table.Th>
                  <Table.Th ta="end">{t.common.orders}</Table.Th>
                  <Table.Th ta="end">{t.reports.average}</Table.Th>
                  <Table.Th ta="end">{t.reports.voids}</Table.Th>
                  <Table.Th ta="end">{t.reports.refunds}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(cashiers.data?.cashiers ?? []).map((c) => (
                  <Table.Tr key={c.cashier}>
                    <Table.Td>{c.cashier}</Table.Td>
                    <Table.Td ta="end">{money(c.sales)}</Table.Td>
                    <Table.Td ta="end">{c.order_count}</Table.Td>
                    <Table.Td ta="end">{money(c.average_sale)}</Table.Td>
                    <Table.Td ta="end">
                      {c.voids > 0 ? (
                        <Badge color="orange" variant="light">
                          {c.voids}
                        </Badge>
                      ) : (
                        0
                      )}
                    </Table.Td>
                    <Table.Td ta="end">
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
                  <Text size="sm" w={48} ta="end" c="dimmed">
                    {String(h.hour).padStart(2, "0")}:00
                  </Text>
                  {/* Simple inline bar — avoids pulling a chart lib for one view. */}
                  <div
                    style={{
                      height: 14,
                      borderRadius: 3,
                      background: "var(--mantine-color-teal-5)",
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
