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
      notifications.show({ title: "Sale voided", message: voidReason, color: "green" });
      setVoidOpen(false);
      setVoidReason("");
      setOverridePin("");
      setSelected(null);
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["shift"] });
    },
    onError: (err) =>
      notifications.show({
        title: "Could not void",
        message: apiError(err, "Failed"),
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
        title: `Refund ${data.number}`,
        message: `${money(data.total)} refunded`,
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
        title: "Could not process return",
        message: apiError(err, "Failed"),
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
      <Title order={2}>Orders</Title>

      <TextInput
        placeholder="Search by receipt number or customer"
        leftSection={<IconSearch size={16} />}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        maw={420}
      />

      <Card withBorder radius="md">
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Receipt</Table.Th>
              <Table.Th>When</Table.Th>
              <Table.Th>Customer</Table.Th>
              <Table.Th>Cashier</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th ta="right">Total</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(orders.data ?? []).length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={7}>
                  <Text c="dimmed" ta="center" py="md">
                    No orders found.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
            {(orders.data ?? []).map((o) => (
              <Table.Tr key={o.id}>
                <Table.Td>{o.receipt_number ?? `#${o.id}`}</Table.Td>
                <Table.Td>{new Date(o.created_at).toLocaleString()}</Table.Td>
                <Table.Td>{o.customer_name ?? "Walk-in"}</Table.Td>
                <Table.Td>{o.created_by_username ?? "—"}</Table.Td>
                <Table.Td>
                  <Badge color={STATUS_COLOR[o.status] ?? "blue"} variant="light">
                    {o.status.replace("_", " ")}
                  </Badge>
                </Table.Td>
                <Table.Td ta="right">{money(o.total)}</Table.Td>
                <Table.Td>
                  <Button size="xs" variant="subtle" onClick={() => setSelected(o)}>
                    View
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
        title={selected ? `Sale ${selected.receipt_number ?? selected.id}` : ""}
        size="lg"
        centered
      >
        {selected && (
          <Stack>
            <Group justify="space-between">
              <Text c="dimmed">{new Date(selected.created_at).toLocaleString()}</Text>
              <Badge color={STATUS_COLOR[selected.status] ?? "blue"}>
                {selected.status.replace("_", " ")}
              </Badge>
            </Group>

            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Item</Table.Th>
                  <Table.Th ta="right">Qty</Table.Th>
                  <Table.Th ta="right">Price</Table.Th>
                  <Table.Th ta="right">Line</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {selected.items.map((i) => (
                  <Table.Tr key={i.id}>
                    <Table.Td>{i.product_name}</Table.Td>
                    <Table.Td ta="right">
                      {Number(i.quantity)} {i.product_unit}
                    </Table.Td>
                    <Table.Td ta="right">{money(i.unit_price)}</Table.Td>
                    <Table.Td ta="right">{money(i.line_total)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>

            <Group justify="space-between">
              <Text fw={600}>Total</Text>
              <Text fw={700}>{money(selected.total)}</Text>
            </Group>

            {selected.payments.length > 0 && (
              <Card withBorder radius="sm" p="sm">
                <Text size="sm" fw={600} mb={4}>
                  Payment
                </Text>
                {selected.payments.map((p) => (
                  <Group key={p.id} justify="space-between">
                    <Text size="sm">
                      {p.method}
                      {p.reference && ` · ${p.reference}`}
                    </Text>
                    <Text size="sm">
                      {money(p.amount)}
                      {Number(p.change) > 0 && ` (change ${money(p.change)})`}
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
                Reprint
              </Button>
              {selected.status === "COMPLETED" && (
                <Button color="gray" onClick={() => setVoidOpen(true)}>
                  Void
                </Button>
              )}
              {["COMPLETED", "PARTIALLY_REFUNDED"].includes(selected.status) && (
                <Button color="orange" onClick={() => setReturnOpen(true)}>
                  Return / refund
                </Button>
              )}
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={voidOpen}
        onClose={() => setVoidOpen(false)}
        title="Void sale"
        centered
      >
        <Stack>
          <Text size="sm" c="dimmed">
            Reverses the whole sale, returns the stock and takes the cash back
            out of the drawer. Only possible while the shift is still open.
          </Text>
          <Textarea
            label="Reason"
            description="Required — recorded in the audit log"
            value={voidReason}
            onChange={(e) => setVoidReason(e.currentTarget.value)}
          />
          {!isSuperadmin && (
            <PasswordInput
              label="Manager PIN"
              description="A supervisor must authorise this void"
              value={overridePin}
              onChange={(e) => setOverridePin(e.currentTarget.value)}
            />
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setVoidOpen(false)}>
              Cancel
            </Button>
            <Button
              color="red"
              disabled={!voidReason.trim() || (!isSuperadmin && !overridePin.trim())}
              loading={voidMutation.isPending}
              onClick={() => voidMutation.mutate()}
            >
              Void sale
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={returnOpen}
        onClose={() => setReturnOpen(false)}
        title="Return / refund"
        size="lg"
        centered
      >
        <Stack>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Item</Table.Th>
                <Table.Th ta="right">Returnable</Table.Th>
                <Table.Th w={140}>Return qty</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(returnable.data?.lines ?? []).map((line) => (
                <Table.Tr key={line.order_item}>
                  <Table.Td>{line.product}</Table.Td>
                  <Table.Td ta="right">{Number(line.returnable)}</Table.Td>
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
              label="Refund to"
              data={[
                { value: "CASH", label: "Cash" },
                { value: "CARD", label: "Card" },
                { value: "MOBILE", label: "Mobile / wallet" },
                { value: "VOUCHER", label: "Voucher" },
                { value: "OTHER", label: "Other" },
              ]}
              value={refundMethod}
              onChange={(v) => setRefundMethod(v || "CASH")}
              allowDeselect={false}
            />
            <Select
              label="Put back into stock?"
              data={[
                { value: "yes", label: "Yes — resaleable" },
                { value: "no", label: "No — damaged / written off" },
              ]}
              value={restock}
              onChange={(v) => setRestock(v || "yes")}
              allowDeselect={false}
            />
          </Group>

          <Textarea
            label="Reason"
            description="Required — recorded in the audit log"
            value={returnReason}
            onChange={(e) => setReturnReason(e.currentTarget.value)}
          />
          {!isSuperadmin && (
            <PasswordInput
              label="Manager PIN"
              description="A supervisor must authorise this refund"
              value={overridePin}
              onChange={(e) => setOverridePin(e.currentTarget.value)}
            />
          )}

          <Group justify="space-between">
            <Text fw={600}>Refund total</Text>
            <Text fw={700}>{totalRefund.toFixed(2)}</Text>
          </Group>

          <Group justify="flex-end">
            <Button variant="default" onClick={() => setReturnOpen(false)}>
              Cancel
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
              Refund {totalRefund.toFixed(2)}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
