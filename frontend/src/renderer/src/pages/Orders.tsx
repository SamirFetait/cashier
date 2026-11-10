import {
  Badge,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  PasswordInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconPrinter, IconSearch } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../api/client";
import type { Order, Paginated, ReturnableInfo } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { useI18n } from "../i18n";
import { PAYMENT_METHODS } from "../pos/PaymentModal";
import { printOrderReceipt } from "../receipt/receipt";

const STATUS_COLOR: Record<string, string> = {
  COMPLETED: "green",
  VOIDED: "gray",
  REFUNDED: "red",
  PARTIALLY_REFUNDED: "orange",
  CANCELLED: "gray",
};

function money(v: string | number) {
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

export function Orders() {
  const qc = useQueryClient();
  const { isSuperadmin } = useAuth();
  const { t, formatDateTime } = useI18n();
  // Cashiers need a supervisor to key in a PIN; managers authorise themselves.
  const [overridePin, setOverridePin] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Order | null>(null);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const [refundMethod, setRefundMethod] = useState("CASH");
  const [restock, setRestock] = useState("yes");
  const [returnQty, setReturnQty] = useState<Record<number, number>>({});

  const orders = useQuery({
    queryKey: ["orders", search],
    queryFn: async () =>
      (
        await api.get<Paginated<Order>>(
          `/orders/?page_size=50${search ? `&search=${encodeURIComponent(search)}` : ""}`
        )
      ).data.results,
  });

  const returnable = useQuery({
    queryKey: ["returnable", selected?.id],
    queryFn: async () =>
      (await api.get<ReturnableInfo>(`/orders/${selected!.id}/returnable/`)).data,
    enabled: !!selected && returnOpen,
  });

  const voidMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/orders/${selected!.id}/void/`, {
          reason: voidReason,
          override_pin: overridePin,
        })
      ).data,
    onSuccess: () => {
      notifications.show({ title: t.orders.voided, message: voidReason, color: "green" });
      setVoidOpen(false);
      setVoidReason("");
      setOverridePin("");
      setSelected(null);
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["shift"] });
    },
    onError: (err) =>
      notifications.show({
        title: t.orders.voidFailed,
        message: apiError(err, t.common.failed),
        color: "red",
      }),
  });

  const returnMutation = useMutation({
    mutationFn: async () => {
      const lines = Object.entries(returnQty)
        .filter(([, qty]) => qty > 0)
        .map(([itemId, qty]) => ({ order_item: Number(itemId), quantity: qty }));
      return (
        await api.post(`/orders/${selected!.id}/return/`, {
          lines,
          refund_method: refundMethod,
          reason: returnReason,
          restock: restock === "yes",
          override_pin: overridePin,
        })
      ).data;
    },
    onSuccess: (data: any) => {
      notifications.show({
        title: t.orders.refundDone(data.number),
        message: t.orders.refundedAmount(money(data.total)),
        color: "green",
      });
      setReturnOpen(false);
      setReturnReason("");
      setReturnQty({});
      setOverridePin("");
      setSelected(null);
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["shift"] });
    },
    onError: (err) =>
      notifications.show({
        title: t.orders.returnFailed,
        message: apiError(err, t.common.failed),
        color: "red",
      }),
  });

  const totalRefund = selected
    ? Object.entries(returnQty).reduce((sum, [itemId, qty]) => {
        const item = selected.items.find((i) => i.id === Number(itemId));
        if (!item || qty <= 0) return sum;
        const unit = Number(item.line_total) / Number(item.quantity);
        return sum + unit * qty;
      }, 0)
    : 0;

  return (
    <Stack>
      <Title order={2}>{t.nav.orders}</Title>

      <TextInput
        placeholder={t.orders.search}
        leftSection={<IconSearch size={16} />}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        maw={420}
      />

      <Card withBorder radius="md">
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t.orders.receipt}</Table.Th>
              <Table.Th>{t.orders.when}</Table.Th>
              <Table.Th>{t.common.customer}</Table.Th>
              <Table.Th>{t.common.cashier}</Table.Th>
              <Table.Th>{t.common.status}</Table.Th>
              <Table.Th ta="end">{t.common.total}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(orders.data ?? []).length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={7}>
                  <Text c="dimmed" ta="center" py="md">
                    {t.orders.none}
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
            {(orders.data ?? []).map((o) => (
              <Table.Tr key={o.id}>
                <Table.Td>{o.receipt_number ?? `#${o.id}`}</Table.Td>
                <Table.Td>{formatDateTime(o.created_at)}</Table.Td>
                <Table.Td>{o.customer_name ?? t.common.walkIn}</Table.Td>
                <Table.Td>{o.created_by_username ?? "—"}</Table.Td>
                <Table.Td>
                  <Badge color={STATUS_COLOR[o.status] ?? "teal"} variant="light">
                    {t.orderStatus[o.status]}
                  </Badge>
                </Table.Td>
                <Table.Td ta="end">{money(o.total)}</Table.Td>
                <Table.Td>
                  <Button size="xs" variant="subtle" onClick={() => setSelected(o)}>
                    {t.orders.view}
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      <Modal
        opened={!!selected && !voidOpen && !returnOpen}
        onClose={() => setSelected(null)}
        title={selected ? t.orders.sale(selected.receipt_number ?? selected.id) : ""}
        size="lg"
        centered
      >
        {selected && (
          <Stack>
            <Group justify="space-between">
              <Text c="dimmed">{formatDateTime(selected.created_at)}</Text>
              <Badge color={STATUS_COLOR[selected.status] ?? "teal"}>
                {t.orderStatus[selected.status]}
              </Badge>
            </Group>

            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t.common.item}</Table.Th>
                  <Table.Th ta="end">{t.common.qty}</Table.Th>
                  <Table.Th ta="end">{t.common.price}</Table.Th>
                  <Table.Th ta="end">{t.common.line}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {selected.items.map((i) => (
                  <Table.Tr key={i.id}>
                    <Table.Td>{i.product_name}</Table.Td>
                    <Table.Td ta="end">
                      {Number(i.quantity)} {i.product_unit}
                    </Table.Td>
                    <Table.Td ta="end">{money(i.unit_price)}</Table.Td>
                    <Table.Td ta="end">{money(i.line_total)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>

            <Group justify="space-between">
              <Text fw={600}>{t.common.total}</Text>
              <Text fw={700}>{money(selected.total)}</Text>
            </Group>

            {selected.payments.length > 0 && (
              <Card withBorder radius="sm" p="sm">
                <Text size="sm" fw={600} mb={4}>
                  {t.orders.payment}
                </Text>
                {selected.payments.map((p) => (
                  <Group key={p.id} justify="space-between">
                    <Text size="sm">
                      {t.paymentMethods[p.method]}
                      {p.reference && ` · ${p.reference}`}
                    </Text>
                    <Text size="sm">
                      {money(p.amount)}
                      {Number(p.change) > 0 && t.orders.changeNote(money(p.change))}
                    </Text>
                  </Group>
                ))}
              </Card>
            )}

            <Group justify="flex-end">
              <Button
                variant="default"
                leftSection={<IconPrinter size={16} />}
                onClick={() => printOrderReceipt(selected)}
              >
                {t.orders.reprint}
              </Button>
              {selected.status === "COMPLETED" && (
                <Button color="gray" onClick={() => setVoidOpen(true)}>
                  {t.orders.void}
                </Button>
              )}
              {["COMPLETED", "PARTIALLY_REFUNDED"].includes(selected.status) && (
                <Button color="orange" onClick={() => setReturnOpen(true)}>
                  {t.orders.returnRefund}
                </Button>
              )}
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={voidOpen}
        onClose={() => setVoidOpen(false)}
        title={t.orders.voidTitle}
        centered
      >
        <Stack>
          <Text size="sm" c="dimmed">
            {t.orders.voidBody}
          </Text>
          <Textarea
            label={t.common.reason}
            description={t.common.reasonRequired}
            value={voidReason}
            onChange={(e) => setVoidReason(e.currentTarget.value)}
          />
          {!isSuperadmin && (
            <PasswordInput
              label={t.common.managerPin}
              description={t.orders.voidPinHint}
              value={overridePin}
              onChange={(e) => setOverridePin(e.currentTarget.value)}
            />
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setVoidOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              color="red"
              disabled={!voidReason.trim() || (!isSuperadmin && !overridePin.trim())}
              loading={voidMutation.isPending}
              onClick={() => voidMutation.mutate()}
            >
              {t.orders.voidTitle}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={returnOpen}
        onClose={() => setReturnOpen(false)}
        title={t.orders.returnRefund}
        size="lg"
        centered
      >
        <Stack>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t.common.item}</Table.Th>
                <Table.Th ta="end">{t.orders.returnable}</Table.Th>
                <Table.Th w={140}>{t.orders.returnQty}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(returnable.data?.lines ?? []).map((line) => (
                <Table.Tr key={line.order_item}>
                  <Table.Td>{line.product}</Table.Td>
                  <Table.Td ta="end">{Number(line.returnable)}</Table.Td>
                  <Table.Td>
                    <NumberInput
                      min={0}
                      max={Number(line.returnable)}
                      decimalScale={3}
                      value={returnQty[line.order_item] ?? 0}
                      onChange={(v) =>
                        setReturnQty((prev) => ({
                          ...prev,
                          [line.order_item]: Number(v) || 0,
                        }))
                      }
                    />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>

          <Group grow>
            <Select
              label={t.orders.refundTo}
              data={PAYMENT_METHODS.map((value) => ({
                value,
                label: t.paymentMethods[value],
              }))}
              value={refundMethod}
              onChange={(v) => setRefundMethod(v || "CASH")}
              allowDeselect={false}
            />
            <Select
              label={t.orders.restockLabel}
              data={[
                { value: "yes", label: t.orders.restockYes },
                { value: "no", label: t.orders.restockNo },
              ]}
              value={restock}
              onChange={(v) => setRestock(v || "yes")}
              allowDeselect={false}
            />
          </Group>

          <Textarea
            label={t.common.reason}
            description={t.common.reasonRequired}
            value={returnReason}
            onChange={(e) => setReturnReason(e.currentTarget.value)}
          />
          {!isSuperadmin && (
            <PasswordInput
              label={t.common.managerPin}
              description={t.orders.refundPinHint}
              value={overridePin}
              onChange={(e) => setOverridePin(e.currentTarget.value)}
            />
          )}

          <Group justify="space-between">
            <Text fw={600}>{t.orders.refundTotal}</Text>
            <Text fw={700}>{totalRefund.toFixed(2)}</Text>
          </Group>

          <Group justify="flex-end">
            <Button variant="default" onClick={() => setReturnOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              color="orange"
              disabled={
                !returnReason.trim() ||
                totalRefund <= 0 ||
                (!isSuperadmin && !overridePin.trim())
              }
              loading={returnMutation.isPending}
              onClick={() => returnMutation.mutate()}
            >
              {t.orders.refundButton(totalRefund.toFixed(2))}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
