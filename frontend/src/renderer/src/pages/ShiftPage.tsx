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
import { label, ltr, useI18n } from "../i18n";
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
  const { t } = useI18n();
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
        title: t.shift.opened,
        message: t.shift.openedMessage(data.number, money(data.opening_float)),
        color: "green",
      });
      qc.invalidateQueries({ queryKey: ["shift"] });
    },
    onError: (err) =>
      notifications.show({
        title: t.shift.openFailed,
        message: apiError(err, t.common.failed),
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
        title: t.shift.closeFailed,
        message: apiError(err, t.common.failed),
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
      notifications.show({ title: t.shift.movementRecorded, message: cashReason, color: "green" });
      setCashOpen(false);
      setCashAmount("");
      setCashReason("");
      qc.invalidateQueries({ queryKey: ["shift"] });
    },
    onError: (err) =>
      notifications.show({
        title: t.shift.movementFailed,
        message: apiError(err, t.common.failed),
        color: "red",
      }),
  });

  if (!shift) {
    return (
      <Stack>
        <Title order={2}>{t.shift.heading}</Title>
        {zReport && <ZReportCard report={zReport} onDismiss={() => setZReport(null)} />}
        <Card withBorder radius="md" maw={480}>
          <Stack>
            <Text>{t.shift.noShift}</Text>
            <NumberInput
              label={t.shift.openingFloat}
              description={t.shift.openingFloatHint}
              min={0}
              decimalScale={2}
              value={openFloat}
              onChange={(v) => setOpenFloat(v === "" ? "" : Number(v))}
            />
            <TextInput
              label={t.shift.terminalLabel}
              placeholder={t.shift.terminalPlaceholder}
              value={terminal}
              onChange={(e) => setTerminal(e.currentTarget.value)}
            />
            <Button
              onClick={() => openMutation.mutate()}
              loading={openMutation.isPending}
            >
              {t.shift.open}
            </Button>
          </Stack>
        </Card>
      </Stack>
    );
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t.shift.title(shift.number)}</Title>
        <Group>
          <Badge size="lg" color="green">
            {t.shift.statusOpen}
          </Badge>
          <Button
            variant="light"
            leftSection={<IconCash size={16} />}
            onClick={() => setCashOpen(true)}
          >
            {t.shift.cashInOut}
          </Button>
          <Button
            variant="default"
            onClick={async () => {
              const result = await platform.openCashDrawer();
              if (!result.success) {
                notifications.show({
                  title: t.shift.drawerFailed,
                  message: result.error ?? t.shift.noPrinter,
                  color: "red",
                });
              }
            }}
          >
            {t.shift.openDrawer}
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
            {t.shift.printX}
          </Button>
          <Button
            color="orange"
            leftSection={<IconLock size={16} />}
            onClick={() => setCloseOpen(true)}
          >
            {t.shift.close}
          </Button>
        </Group>
      </Group>

      <Grid>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder radius="md">
            <Title order={4} mb="sm">
              <Group gap="xs">
                <IconReceipt size={18} /> {t.shift.xReport}
              </Group>
            </Title>
            <Text size="xs" c="dimmed" mb="sm">
              {t.shift.xReportHint}
            </Text>
            <Table>
              <Table.Tbody>
                <Table.Tr>
                  <Table.Td>{t.shift.openedBy}</Table.Td>
                  <Table.Td ta="end">{report?.opened_by}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td>{t.shift.openingFloat}</Table.Td>
                  <Table.Td ta="end">{money(report?.opening_float)}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td>{t.common.sales}</Table.Td>
                  <Table.Td ta="end">
                    {money(report?.sales_total)} ({report?.order_count})
                  </Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td>{t.shift.voidsRefunds}</Table.Td>
                  <Table.Td ta="end">
                    {report?.void_count} / {report?.refund_count}
                  </Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td fw={600}>{t.shift.expectedInDrawer}</Table.Td>
                  <Table.Td ta="end" fw={700}>
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
              {t.shift.paymentsTaken}
            </Title>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t.common.method}</Table.Th>
                  <Table.Th ta="end">{t.shift.count}</Table.Th>
                  <Table.Th ta="end">{t.common.total}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(report?.payments ?? []).length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={3}>
                      <Text c="dimmed">{t.shift.noPayments}</Text>
                    </Table.Td>
                  </Table.Tr>
                )}
                {(report?.payments ?? []).map((p) => (
                  <Table.Tr key={p.method}>
                    <Table.Td>{label(t.paymentMethods, p.method)}</Table.Td>
                    <Table.Td ta="end">{p.count}</Table.Td>
                    <Table.Td ta="end">{money(p.total)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>

            <Title order={4} mt="lg" mb="sm">
              {t.shift.drawerMovements}
            </Title>
            <Table>
              <Table.Tbody>
                {(report?.cash_movements ?? []).map((m) => (
                  <Table.Tr key={m.kind}>
                    <Table.Td>{label(t.cashKinds, m.kind)}</Table.Td>
                    <Table.Td ta="end">{money(m.total)}</Table.Td>
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
        title={t.shift.close}
        centered
      >
        <Stack>
          <Alert color="teal">{t.shift.closeHint}</Alert>
          <NumberInput
            label={t.shift.countedCash}
            min={0}
            decimalScale={2}
            value={counted}
            onChange={(v) => setCounted(v === "" ? "" : Number(v))}
            data-autofocus
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCloseOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              color="orange"
              onClick={() => closeMutation.mutate()}
              loading={closeMutation.isPending}
              disabled={counted === ""}
            >
              {t.shift.closeAndReconcile}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={cashOpen}
        onClose={() => setCashOpen(false)}
        title={t.shift.cashInOut}
        centered
      >
        <Stack>
          <Select
            label={t.shift.movementType}
            data={[
              { value: "PAY_IN", label: t.shift.kindPayIn },
              { value: "PAY_OUT", label: t.shift.kindPayOut },
              { value: "DROP", label: t.shift.kindDrop },
            ]}
            value={cashKind}
            onChange={(v) => setCashKind(v || "PAY_OUT")}
            allowDeselect={false}
          />
          <NumberInput
            label={t.common.amount}
            min={0}
            decimalScale={2}
            value={cashAmount}
            onChange={(v) => setCashAmount(v === "" ? "" : Number(v))}
          />
          <TextInput
            label={t.common.reason}
            description={t.shift.reasonHint}
            value={cashReason}
            onChange={(e) => setCashReason(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCashOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              onClick={() => cashMutation.mutate()}
              loading={cashMutation.isPending}
              disabled={!cashReason.trim() || !cashAmount}
            >
              {t.shift.record}
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
  const { t } = useI18n();
  const variance = Number(report.variance ?? 0);
  const over = variance > 0;
  const short = variance < 0;
  return (
    <Card withBorder radius="md" maw={520}>
      <Group justify="space-between" mb="sm">
        <Title order={4}>{t.shift.zReport(report.shift)}</Title>
        <Badge color={variance === 0 ? "green" : short ? "red" : "yellow"}>
          {variance === 0 ? t.shift.balanced : short ? t.shift.short : t.shift.over}
        </Badge>
      </Group>
      <Table>
        <Table.Tbody>
          <Table.Tr>
            <Table.Td>{t.common.sales}</Table.Td>
            <Table.Td ta="end">
              {money(report.sales_total)} ({report.order_count})
            </Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>{t.shift.expected}</Table.Td>
            <Table.Td ta="end">{money(report.expected_cash)}</Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>{t.shift.counted}</Table.Td>
            <Table.Td ta="end">{money(report.counted_cash)}</Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td fw={600}>{t.shift.variance}</Table.Td>
            <Table.Td ta="end" fw={700} c={variance === 0 ? undefined : short ? "red" : "yellow"}>
              {ltr(`${over ? "+" : ""}${money(report.variance)}`)}
            </Table.Td>
          </Table.Tr>
        </Table.Tbody>
      </Table>
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={onDismiss}>
          {t.shift.dismiss}
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
          {t.shift.printZ}
        </Button>
      </Group>
    </Card>
  );
}
