import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

import type { PaymentMethod } from "../api/types";
import { useI18n } from "../i18n";

export interface TenderLine {
  method: PaymentMethod;
  amount: number;
  tendered?: number;
  reference?: string;
}

/** Tender types in the order they are offered; labels come from i18n. */
export const PAYMENT_METHODS: PaymentMethod[] = ["CASH", "CARD", "MOBILE", "VOUCHER", "OTHER"];

/** Notes a cashier reaches for first, to save typing the exact amount. */
const QUICK_CASH = [5, 10, 20, 50, 100];

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function PaymentModal({
  opened,
  total,
  onClose,
  onConfirm,
  submitting,
}: {
  opened: boolean;
  total: number;
  onClose: () => void;
  onConfirm: (payments: TenderLine[]) => void;
  submitting: boolean;
}) {
  const { t } = useI18n();
  const methodOptions = PAYMENT_METHODS.map((value) => ({
    value,
    label: t.paymentMethods[value],
  }));
  const [lines, setLines] = useState<TenderLine[]>([]);
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [amount, setAmount] = useState<number | "">("");
  const [tendered, setTendered] = useState<number | "">("");
  const [reference, setReference] = useState("");

  const allocated = useMemo(
    () => round2(lines.reduce((s, l) => s + l.amount, 0)),
    [lines]
  );
  const remaining = round2(total - allocated);

  // Default the next tender to whatever is still owed — the common case is a
  // single payment for the full amount.
  useEffect(() => {
    if (opened) {
      setLines([]);
      setMethod("CASH");
      setReference("");
      setTendered("");
    }
  }, [opened]);

  useEffect(() => {
    setAmount(remaining > 0 ? remaining : "");
  }, [remaining, opened]);

  const amountNum = typeof amount === "number" ? amount : 0;
  const tenderedNum = typeof tendered === "number" ? tendered : 0;
  const change =
    method === "CASH" && tenderedNum > amountNum ? round2(tenderedNum - amountNum) : 0;

  function addLine() {
    if (amountNum <= 0) return;
    if (amountNum > remaining + 0.001) return;
    const line: TenderLine = { method, amount: round2(amountNum) };
    if (method === "CASH") line.tendered = tenderedNum > 0 ? round2(tenderedNum) : undefined;
    if (reference.trim()) line.reference = reference.trim();
    setLines((prev) => [...prev, line]);
    setTendered("");
    setReference("");
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  function payExact() {
    onConfirm([
      { method, amount: round2(total), tendered: method === "CASH" ? round2(total) : undefined },
    ]);
  }

  function quickCash(note: number) {
    if (note < remaining) return;
    onConfirm([{ method: "CASH", amount: round2(total), tendered: note }]);
  }

  const settled = Math.abs(remaining) < 0.005;
  const canConfirm = settled && lines.length > 0 && !submitting;

  return (
    <Modal opened={opened} onClose={onClose} title={t.newOrder.takePayment} size="lg" centered>
      <Stack>
        <Group justify="space-between">
          <Text size="lg">{t.payment.totalDue}</Text>
          <Text size="xl" fw={700}>
            {total.toFixed(2)}
          </Text>
        </Group>

        {lines.length === 0 && (
          <>
            <Text size="sm" c="dimmed">
              {t.payment.quickCash}
            </Text>
            <Group>
              <Button variant="light" onClick={payExact} disabled={submitting}>
                {t.payment.exact(total.toFixed(2))}
              </Button>
              {QUICK_CASH.filter((n) => n >= total).map((n) => (
                <Button
                  key={n}
                  variant="light"
                  onClick={() => quickCash(n)}
                  disabled={submitting}
                >
                  {n.toFixed(2)}
                </Button>
              ))}
            </Group>
            <Divider label={t.payment.orSplit} labelPosition="center" />
          </>
        )}

        {lines.length > 0 && (
          <Table withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t.common.method}</Table.Th>
                <Table.Th>{t.common.amount}</Table.Th>
                <Table.Th>{t.payment.tendered}</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {lines.map((l, i) => (
                <Table.Tr key={i}>
                  <Table.Td>{t.paymentMethods[l.method]}</Table.Td>
                  <Table.Td>{l.amount.toFixed(2)}</Table.Td>
                  <Table.Td>{l.tendered ? l.tendered.toFixed(2) : "—"}</Table.Td>
                  <Table.Td>
                    <ActionIcon
                      color="red"
                      variant="subtle"
                      onClick={() => removeLine(i)}
                      aria-label={t.payment.removeTender}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}

        {!settled && (
          <Group align="flex-end" grow>
            <Select
              label={t.common.method}
              data={methodOptions}
              value={method}
              onChange={(v) => setMethod((v as PaymentMethod) || "CASH")}
              allowDeselect={false}
            />
            <NumberInput
              label={t.common.amount}
              min={0}
              max={remaining}
              decimalScale={2}
              value={amount}
              onChange={(v) => setAmount(v === "" ? "" : Number(v))}
            />
            {method === "CASH" ? (
              <NumberInput
                label={t.payment.cashGiven}
                min={0}
                decimalScale={2}
                value={tendered}
                onChange={(v) => setTendered(v === "" ? "" : Number(v))}
              />
            ) : (
              <TextInput
                label={t.payment.reference}
                placeholder={t.payment.referencePlaceholder}
                value={reference}
                onChange={(e) => setReference(e.currentTarget.value)}
              />
            )}
            <Button onClick={addLine} disabled={amountNum <= 0}>
              {t.common.add}
            </Button>
          </Group>
        )}

        {change > 0 && (
          <Alert color="teal" title={t.payment.changeDue}>
            <Text size="xl" fw={700}>
              {change.toFixed(2)}
            </Text>
          </Alert>
        )}

        <Group justify="space-between">
          <Text>{t.payment.remaining}</Text>
          <Badge size="lg" color={settled ? "green" : "orange"}>
            {remaining.toFixed(2)}
          </Badge>
        </Group>

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={submitting}>
            {t.common.cancel}
          </Button>
          <Button onClick={() => onConfirm(lines)} disabled={!canConfirm} loading={submitting}>
            {t.payment.complete}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
