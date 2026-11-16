/**
 * Hand-over: preview the sale as checkout will ring it, take the balance, and
 * record it. The sale lands in this shift like any other, and the receipt
 * prints the way it does at the till.
 */
import {
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  SegmentedControl,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { api } from "../api/client";
import type { Order, WebOrderDetail } from "../api/types";
import { ltr, useI18n } from "../i18n";
import { PinPrompt } from "../pos/PinPrompt";
import { printOrderReceipt } from "../receipt/receipt";
import { errorText, money, shopError, toNumber, useOrderAction, useSalePlan, type PriceMode } from "./api";

type Method = "CASH" | "MOBILE" | "CARD";

export function CompleteModal({
  opened,
  order,
  onClose,
}: {
  opened: boolean;
  order: WebOrderDetail;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const w = t.webOrders.complete;
  const client = useQueryClient();
  const action = useOrderAction(order.id);
  const [mode, setMode] = useState<PriceMode>("quoted");
  const [method, setMethod] = useState<Method>("CASH");
  const [reference, setReference] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // First a look without a choice, to learn whether prices moved at all.
  const base = useSalePlan(order.id, null, opened);
  const changed = (base.data?.changes.length ?? 0) > 0;
  const chosen = useSalePlan(order.id, mode, opened && changed);
  const plan = changed ? chosen.data : base.data;
  const balance = toNumber(plan?.balance);

  useEffect(() => {
    if (opened) {
      setError(null);
      setReference("");
      setMethod("CASH");
      setMode("quoted");
    }
  }, [opened]);

  async function submit(pin = "") {
    setError(null);
    try {
      const done = await action.mutateAsync({
        action: "complete",
        body: {
          balance_method: balance > 0 ? method : "",
          balance_reference: reference.trim(),
          price_mode: changed ? mode : null,
          override_pin: pin,
        },
      });
      setPinOpen(false);
      onClose();
      notifications.show({ color: "green", message: w.done(done.pos.receipt_number) });
      void client.invalidateQueries({ queryKey: ["orders"] });
      void client.invalidateQueries({ queryKey: ["shift"] });
      if (done.pos.order_id) {
        // A printer fault must not look like a failed sale: it is recorded,
        // and the receipt can be printed again from the order.
        let printed: { success: boolean; error?: string; cancelled?: boolean };
        try {
          const sale = (await api.get<Order>(`/orders/${done.pos.order_id}/`)).data;
          printed = await printOrderReceipt(sale);
        } catch (err) {
          printed = { success: false, error: (err as Error).message };
        }
        if (!printed.success && !printed.cancelled) {
          notifications.show({
            color: "orange",
            title: t.newOrder.receiptFailed,
            message: printed.error || t.newOrder.receiptFailedHint,
          });
        }
      }
    } catch (failure) {
      const code = shopError(failure)?.code;
      if (code === "PIN_REQUIRED" || code === "PIN_INVALID") {
        setPinOpen(true);
        if (code === "PIN_INVALID") setError(errorText(failure, t));
        return;
      }
      setPinOpen(false);
      if (code === "PRICE_CHANGED") void base.refetch();
      setError(errorText(failure, t));
    }
  }

  return (
    <>
      <Modal opened={opened} onClose={onClose} title={`${w.title} · ${ltr(order.code)}`} centered size="lg">
        <Stack>
          <Text size="sm" c="dimmed">
            {w.intro}
          </Text>
          {base.isError && <Alert color="red">{errorText(base.error, t)}</Alert>}
          {!plan && !base.isError && (
            <Group justify="center" py="md">
              <Loader />
            </Group>
          )}

          {changed && base.data && (
            <Alert color="orange" title={w.priceChanged}>
              <Stack gap="xs">
                {base.data.changes.map((line) => (
                  <Text key={line.product_id} size="sm">
                    {line.name}: {w.was} {money(line.quoted_price, t)} → {w.now} {money(line.current_price, t)}
                  </Text>
                ))}
                <SegmentedControl
                  fullWidth
                  value={mode}
                  onChange={(value) => setMode(value as PriceMode)}
                  data={[
                    { value: "quoted", label: w.keepQuoted },
                    { value: "current", label: w.chargeCurrent },
                  ]}
                />
              </Stack>
            </Alert>
          )}

          {plan && (
            <>
              <Table>
                <Table.Tbody>
                  <Table.Tr>
                    <Table.Td>{w.goods}</Table.Td>
                    <Table.Td ta="end">{money(plan.total, t)}</Table.Td>
                  </Table.Tr>
                  {toNumber(plan.deposit_applied) > 0 && (
                    <Table.Tr>
                      <Table.Td>{w.deposit}</Table.Td>
                      <Table.Td ta="end">{ltr(`-${money(plan.deposit_applied, t)}`)}</Table.Td>
                    </Table.Tr>
                  )}
                  {toNumber(plan.delivery_fee_due) > 0 && (
                    <Table.Tr>
                      <Table.Td>{w.deliveryFee}</Table.Td>
                      <Table.Td ta="end">{money(plan.delivery_fee_due, t)}</Table.Td>
                    </Table.Tr>
                  )}
                  <Table.Tr>
                    <Table.Td fw={700}>{w.toCollect}</Table.Td>
                    <Table.Td ta="end" fw={700} fz="lg">
                      {money(plan.to_collect, t)}
                    </Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>

              {balance > 0 && (
                <>
                  <Stack gap={4}>
                    <Text size="sm" fw={500}>
                      {w.method}
                    </Text>
                    <SegmentedControl
                      fullWidth
                      value={method}
                      onChange={(value) => setMethod(value as Method)}
                      data={[
                        { value: "CASH", label: w.CASH },
                        { value: "MOBILE", label: w.MOBILE },
                        { value: "CARD", label: w.CARD },
                      ]}
                    />
                  </Stack>
                  {method !== "CASH" && (
                    <TextInput
                      label={w.reference}
                      value={reference}
                      onChange={(e) => setReference(e.currentTarget.value)}
                      dir="ltr"
                      maxLength={120}
                    />
                  )}
                </>
              )}
            </>
          )}

          {error && <Alert color="red">{error}</Alert>}

          <Group justify="flex-end">
            <Button variant="default" onClick={onClose} disabled={action.isPending}>
              {t.webOrders.order.back}
            </Button>
            <Button color="teal" loading={action.isPending} disabled={!plan} onClick={() => void submit()}>
              {w.submit}
            </Button>
          </Group>
        </Stack>
      </Modal>
      <PinPrompt opened={pinOpen} onClose={() => setPinOpen(false)} onSubmit={(pin) => void submit(pin)} />
    </>
  );
}
