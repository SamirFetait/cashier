import {
  Alert,
  Badge,
  Button,
  Card,
  Grid,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCash, IconLock, IconReceipt } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../api/client";
import type { Shift, ShiftReport } from "../api/types";
import { platform } from "../platform";
import { printShiftReport } from "../receipt/receipt";

function money(v: string | number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return Number(v).toFixed(2);
}

function apiError(err: any, fallback: string) {
  const data = err?.response?.data;
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return data.join(" ");
  if (data && typeof data === "object") {
    return (
      data.detail ||
      Object.entries(data)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(" ") : v}`)
        .join(" · ")
    );
  }
  return fallback;
}

export function ShiftPage() {
  const qc = useQueryClient();
  const [openFloat, setOpenFloat] = useState<number | "">(0);
  const [terminal, setTerminal] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [counted, setCounted] = useState<number | "">("");
  const [zReport, setZReport] = useState<ShiftReport | null>(null);
  const [cashOpen, setCashOpen] = useState(false);
  const [cashKind, setCashKind] = useState("PAY_OUT");
  const [cashAmount, setCashAmount] = useState<number | "">("");
  const [cashReason, setCashReason] = useState("");

  const current = useQuery({
    queryKey: ["shift", "current"],
    queryFn: async () =>
      (
        await api.get<{ shift: Shift | null; report?: ShiftReport }>(
          "/shifts/current/"
        )
      ).data,
  });

  const shift = current.data?.shift ?? null;
  const report = current.data?.report ?? null;

  const openMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post<Shift>("/shifts/open/", {
          opening_float: openFloat || 0,
          terminal,
        })
      ).data,
    onSuccess: (data) => {
      notifications.show({
        title: "Shift open",
        message: `${data.number} with float ${money(data.opening_float)}`,
        color: "green",
      });
      qc.invalidateQueries({ queryKey: ["shift"] });
    },
    onError: (err) =>
      notifications.show({
        title: "Could not open shift",
        message: apiError(err, "Failed"),
        color: "red",
      }),
  });

  const closeMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post<ShiftReport>(`/shifts/${shift!.id}/close/`, {
          counted_cash: counted || 0,
        })
      ).data,
    onSuccess: (data) => {
      setZReport(data);
      setCloseOpen(false);
      setCounted("");
      qc.invalidateQueries({ queryKey: ["shift"] });
    },
    onError: (err) =>
      notifications.show({
        title: "Could not close shift",
        message: apiError(err, "Failed"),
        color: "red",
      }),
  });

  const cashMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/shifts/${shift!.id}/cash-movement/`, {
          kind: cashKind,
          amount: cashAmount || 0,
          reason: cashReason,
        })
      ).data,
    onSuccess: () => {
      notifications.show({ title: "Cash movement recorded", message: cashReason, color: "green" });
      setCashOpen(false);
      setCashAmount("");
      setCashReason("");
      qc.invalidateQueries({ queryKey: ["shift"] });
    },
    onError: (err) =>
      notifications.show({
        title: "Could not record movement",
        message: apiError(err, "Failed"),
        color: "red",
      }),
  });

  if (!shift) {
    return (
      <Stack>
        <Title order={2}>Shift</Title>
        {zReport && <ZReportCard report={zReport} onDismiss={() => setZReport(null)} />}
        <Card withBorder radius="md" maw={480}>
          <Stack>
            <Text>No shift is open. Count the drawer and open one to start selling.</Text>
            <NumberInput
              label="Opening float"
              description="Cash physically in the drawer now"
              min={0}
              decimalScale={2}
              value={openFloat}
              onChange={(v) => setOpenFloat(v === "" ? "" : Number(v))}
            />
            <TextInput
              label="Terminal (optional)"
              placeholder="Till 1"
              value={terminal}
              onChange={(e) => setTerminal(e.currentTarget.value)}
            />
            <Button
              onClick={() => openMutation.mutate()}
              loading={openMutation.isPending}
            >
              Open shift
            </Button>
          </Stack>
        </Card>
      </Stack>
    );
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Shift {shift.number}</Title>
        <Group>
          <Badge size="lg" color="green">
            Open
          </Badge>
          <Button
            variant="light"
            leftSection={<IconCash size={16} />}
            onClick={() => setCashOpen(true)}
          >
            Cash in / out
          </Button>
          <Button
            variant="default"
            onClick={async () => {
              const result = await platform.openCashDrawer();
              if (!result.success) {
                notifications.show({
                  title: "Could not open drawer",
                  message: result.error ?? "No thermal printer configured.",
                  color: "red",
                });
              }
            }}
          >
            Open drawer
          </Button>
          <Button
            variant="default"
            leftSection={<IconReceipt size={16} />}
            onClick={async () => {
              if (!report) return;
              const result = await printShiftReport(report, "X");
              if (!result.success) window.print();
            }}
          >
            Print X
          </Button>
          <Button
            color="orange"
            leftSection={<IconLock size={16} />}
            onClick={() => setCloseOpen(true)}
          >
            Close shift
          </Button>
        </Group>
      </Group>

      <Grid>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder radius="md">
            <Title order={4} mb="sm">
              <Group gap="xs">
                <IconReceipt size={18} /> X report
              </Group>
            </Title>
            <Text size="xs" c="dimmed" mb="sm">
              A mid-shift read. Does not close the drawer.
            </Text>
            <Table>
              <Table.Tbody>
                <Table.Tr>
                  <Table.Td>Opened by</Table.Td>
                  <Table.Td ta="right">{report?.opened_by}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td>Opening float</Table.Td>
                  <Table.Td ta="right">{money(report?.opening_float)}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td>Sales</Table.Td>
                  <Table.Td ta="right">
                    {money(report?.sales_total)} ({report?.order_count})
                  </Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td>Voids / refunds</Table.Td>
                  <Table.Td ta="right">
                    {report?.void_count} / {report?.refund_count}
                  </Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td fw={600}>Expected in drawer</Table.Td>
                  <Table.Td ta="right" fw={700}>
                    {money(report?.expected_cash)}
                  </Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder radius="md">
            <Title order={4} mb="sm">
              Payments taken
            </Title>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Method</Table.Th>
                  <Table.Th ta="right">Count</Table.Th>
                  <Table.Th ta="right">Total</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(report?.payments ?? []).length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={3}>
                      <Text c="dimmed">No payments yet.</Text>
                    </Table.Td>
                  </Table.Tr>
                )}
                {(report?.payments ?? []).map((p) => (
                  <Table.Tr key={p.method}>
                    <Table.Td>{p.method}</Table.Td>
                    <Table.Td ta="right">{p.count}</Table.Td>
                    <Table.Td ta="right">{money(p.total)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>

            <Title order={4} mt="lg" mb="sm">
              Drawer movements
            </Title>
            <Table>
              <Table.Tbody>
                {(report?.cash_movements ?? []).map((m) => (
                  <Table.Tr key={m.kind}>
                    <Table.Td>{m.kind}</Table.Td>
                    <Table.Td ta="right">{money(m.total)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>
        </Grid.Col>
      </Grid>

      <Modal
        opened={closeOpen}
        onClose={() => setCloseOpen(false)}
        title="Close shift"
        centered
      >
        <Stack>
          <Alert color="blue">
            Count the drawer and enter the total. The expected figure is hidden
            until you submit, so the count stays honest.
          </Alert>
          <NumberInput
            label="Counted cash"
            min={0}
            decimalScale={2}
            value={counted}
            onChange={(v) => setCounted(v === "" ? "" : Number(v))}
            data-autofocus
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCloseOpen(false)}>
              Cancel
            </Button>
            <Button
              color="orange"
              onClick={() => closeMutation.mutate()}
              loading={closeMutation.isPending}
              disabled={counted === ""}
            >
              Close and reconcile
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={cashOpen}
        onClose={() => setCashOpen(false)}
        title="Cash in / out"
        centered
      >
        <Stack>
          <Select
            label="Type"
            data={[
              { value: "PAY_IN", label: "Paid in (money added)" },
              { value: "PAY_OUT", label: "Paid out (expense)" },
              { value: "DROP", label: "Drop to safe" },
            ]}
            value={cashKind}
            onChange={(v) => setCashKind(v || "PAY_OUT")}
            allowDeselect={false}
          />
          <NumberInput
            label="Amount"
            min={0}
            decimalScale={2}
            value={cashAmount}
            onChange={(v) => setCashAmount(v === "" ? "" : Number(v))}
          />
          <TextInput
            label="Reason"
            description="Required — this is what makes the drawer auditable"
            value={cashReason}
            onChange={(e) => setCashReason(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCashOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => cashMutation.mutate()}
              loading={cashMutation.isPending}
              disabled={!cashReason.trim() || !cashAmount}
            >
              Record
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

function ZReportCard({
  report,
  onDismiss,
}: {
  report: ShiftReport;
  onDismiss: () => void;
}) {
  const variance = Number(report.variance ?? 0);
  const over = variance > 0;
  const short = variance < 0;
  return (
    <Card withBorder radius="md" maw={520}>
      <Group justify="space-between" mb="sm">
        <Title order={4}>Z report — {report.shift}</Title>
        <Badge color={variance === 0 ? "green" : short ? "red" : "yellow"}>
          {variance === 0 ? "Balanced" : short ? "Short" : "Over"}
        </Badge>
      </Group>
      <Table>
        <Table.Tbody>
          <Table.Tr>
            <Table.Td>Sales</Table.Td>
            <Table.Td ta="right">
              {money(report.sales_total)} ({report.order_count})
            </Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>Expected</Table.Td>
            <Table.Td ta="right">{money(report.expected_cash)}</Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>Counted</Table.Td>
            <Table.Td ta="right">{money(report.counted_cash)}</Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td fw={600}>Variance</Table.Td>
            <Table.Td ta="right" fw={700} c={variance === 0 ? undefined : short ? "red" : "yellow"}>
              {over ? "+" : ""}
              {money(report.variance)}
            </Table.Td>
          </Table.Tr>
        </Table.Tbody>
      </Table>
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={onDismiss}>
          Dismiss
        </Button>
        <Button
          onClick={async () => {
            const result = await printShiftReport(report, "Z");
            if (!result.success) {
              // No thermal printer — fall back to the browser dialog.
              window.print();
            }
          }}
        >
          Print Z report
        </Button>
      </Group>
    </Card>
  );
}
