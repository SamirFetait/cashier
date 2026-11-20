/**
 * One website order, in a drawer: who ordered what, the InstaPay transfer to
 * check (deliveries), and every step staff can take, up to ringing the sale up.
 */
import {
  Alert,
  Anchor,
  Badge,
  Button,
  CopyButton,
  Divider,
  Drawer,
  Group,
  Image,
  Loader,
  Modal,
  Paper,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Timeline,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconBrandWhatsapp,
  IconBuildingStore,
  IconCopy,
  IconExternalLink,
  IconPrinter,
  IconTruckDelivery,
} from "@tabler/icons-react";
import { useEffect, useState, type ReactNode } from "react";

import { api } from "../api/client";
import type { Order, WebOrderDetail, WebOrderEvent, WebOrderStatus } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ltr, useI18n, type Messages } from "../i18n";
import { ar } from "../i18n/ar";
import { en } from "../i18n/en";
import { printOrderReceipt } from "../receipt/receipt";
import { CompleteModal } from "./CompleteModal";
import {
  errorText,
  money,
  quantityText,
  serverUrl,
  shopError,
  toNumber,
  useOrderAction,
  useOrderDetail,
  whatsappLink,
  type OrderAction,
} from "./api";

export const STATUS_COLOR: Record<WebOrderStatus, string> = {
  AWAITING_DEPOSIT: "gray",
  DEPOSIT_REVIEW: "orange",
  CONFIRMED: "teal",
  PREPARING: "blue",
  READY: "grape",
  COMPLETED: "green",
  CANCELLED: "red",
  EXPIRED: "gray",
};

export function StatusBadge({ status }: { status: WebOrderStatus }) {
  const { t } = useI18n();
  return (
    <Badge color={STATUS_COLOR[status]} variant="light">
      {t.webOrders.status[status]}
    </Badge>
  );
}

export function OrderDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { t, dir } = useI18n();
  const detail = useOrderDetail(id);
  const order = detail.data;
  return (
    <Drawer
      opened={id !== null}
      onClose={onClose}
      position={dir === "rtl" ? "left" : "right"}
      size="lg"
      title={
        order ? (
          <Group gap="sm">
            <Title order={3}>{ltr(order.code)}</Title>
            <StatusBadge status={order.status} />
          </Group>
        ) : (
          "…"
        )
      }
    >
      {order && order.id === id ? (
        <OrderBody key={order.id} order={order} />
      ) : detail.isError ? (
        <Alert color="red">{errorText(detail.error, t)}</Alert>
      ) : (
        <Stack>
          <Skeleton h={120} />
          <Skeleton h={220} />
        </Stack>
      )}
    </Drawer>
  );
}

function Section({ title, children, tone }: { title: string; children: ReactNode; tone?: "orange" }) {
  return (
    <Paper withBorder radius="md" p="md" bg={tone ? "var(--mantine-color-orange-light)" : undefined}>
      <Text fw={700} mb="xs">
        {title}
      </Text>
      {children}
    </Paper>
  );
}

/** Messages to the customer go out in the language they ordered in. */
function customerMessages(order: WebOrderDetail): Messages["webOrders"]["messages"] {
  return (order.language === "en" ? en : ar).webOrders.messages;
}

function OrderBody({ order }: { order: WebOrderDetail }) {
  const { t, formatDateTime } = useI18n();
  const w = t.webOrders.order;
  const { isSuperadmin } = useAuth();
  const action = useOrderAction(order.id);
  const [dialog, setDialog] = useState<"cancel" | "reject" | "complete" | null>(null);

  async function run(name: OrderAction, body?: Record<string, unknown>): Promise<boolean> {
    try {
      await action.mutateAsync({ action: name, body });
      return true;
    } catch (error) {
      notifications.show({ color: "red", message: errorText(error, t) });
      return false;
    }
  }

  const status = order.status;
  const pickup = order.fulfilment === "PICKUP";
  const reviewable = status === "DEPOSIT_REVIEW" || status === "AWAITING_DEPOSIT" || status === "EXPIRED";
  const inProgress = status === "CONFIRMED" || status === "PREPARING" || status === "READY";
  const open = reviewable ? status !== "EXPIRED" : inProgress;
  const paid = toNumber(order.deposit_paid);
  const mayCancel = open && (paid === 0 || isSuperadmin);
  const takesDeposit = toNumber(order.deposit_required) > 0 || paid > 0;

  // In the customer's language, with amounts as they will read them.
  const m = customerMessages(order);
  const say = (text: string) => whatsappLink(order.whatsapp, text);
  const customerT = order.language === "en" ? en : ar;
  const cash = (value: string) => money(value, customerT);

  return (
    <Stack>
      {order.shortages.length > 0 && (
        <Alert color="orange" title={w.shortage}>
          {order.shortages.map((line) => (
            <Text key={line.product_id} size="sm">
              {w.shortageLine(line.name, line.needed, line.free)}
            </Text>
          ))}
        </Alert>
      )}

      <Section title={w.customer}>
        <Stack gap="xs">
          <Text fw={600} size="lg">
            {order.customer_name}
          </Text>
          <Group gap="xs">
            <Text>{ltr(order.phone)}</Text>
            <Button
              component="a"
              href={say("")}
              target="_blank"
              rel="noreferrer"
              size="xs"
              color="green"
              variant="light"
              leftSection={<IconBrandWhatsapp size={16} />}
            >
              {w.whatsapp}
            </Button>
          </Group>
          <Group gap={6}>
            {pickup ? <IconBuildingStore size={18} /> : <IconTruckDelivery size={18} />}
            <Text>{pickup ? t.webOrders.pickup : t.webOrders.delivery}</Text>
            {order.address && <Text c="dimmed">· {order.address}</Text>}
          </Group>
          {order.notes && (
            <Text size="sm">
              <b>{w.notes}:</b> {order.notes}
            </Text>
          )}
          <Text size="sm" c="dimmed">
            {order.history.orders === 0
              ? w.firstOrder
              : w.history(order.history.orders, order.history.completed, order.history.cancelled)}
          </Text>
          <Group gap="xs">
            <Text size="sm">{w.trackingLink}</Text>
            <CopyButton value={order.tracking_url}>
              {({ copied, copy }) => (
                <Button size="compact-xs" variant="subtle" leftSection={<IconCopy size={14} />} onClick={copy}>
                  {copied ? w.copied : w.copy}
                </Button>
              )}
            </CopyButton>
          </Group>
          {(inProgress || status === "AWAITING_DEPOSIT" || status === "DEPOSIT_REVIEW") && (
            <Group gap="xs">
              <Text size="sm" c="dimmed">
                {w.messages}:
              </Text>
              {inProgress && (
                <Anchor
                  size="sm"
                  target="_blank"
                  rel="noreferrer"
                  href={say(
                    pickup && paid === 0
                      ? m.confirmedPickup(order.customer_name, order.code, cash(order.balance_due), order.tracking_url)
                      : m.confirmed(
                          order.customer_name,
                          order.code,
                          cash(order.deposit_paid),
                          cash(order.balance_due),
                          order.tracking_url
                        )
                  )}
                >
                  {w.msgConfirmed}
                </Anchor>
              )}
              {status === "READY" && (
                <Anchor
                  size="sm"
                  target="_blank"
                  rel="noreferrer"
                  href={say(
                    (pickup ? m.readyPickup : m.readyDelivery)(order.customer_name, order.code, cash(order.balance_due))
                  )}
                >
                  {w.msgReady}
                </Anchor>
              )}
              {(status === "AWAITING_DEPOSIT" || status === "DEPOSIT_REVIEW") && (
                <Anchor
                  size="sm"
                  target="_blank"
                  rel="noreferrer"
                  href={say(m.notFound(order.customer_name, order.code, order.tracking_url))}
                >
                  {w.msgNotFound}
                </Anchor>
              )}
            </Group>
          )}
        </Stack>
      </Section>

      <Section title={w.items}>
        <Table verticalSpacing={6}>
          <Table.Tbody>
            {order.items.map((item) => (
              <Table.Tr key={item.product_id}>
                <Table.Td w={48}>
                  {item.thumb ? (
                    <Image src={serverUrl(item.thumb)} w={40} h={40} radius="sm" fit="cover" alt="" />
                  ) : null}
                </Table.Td>
                <Table.Td>
                  <Text size="sm" fw={500}>
                    {item.name}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {quantityText(item.qty, item.sold_by, item.unit)} × {money(item.unit_price, t)}
                  </Text>
                </Table.Td>
                <Table.Td ta="end">{money(item.line_total, t)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Divider my="xs" />
        <Stack gap={4}>
          <Row label={w.subtotal} value={money(order.subtotal, t)} />
          {toNumber(order.discount) > 0 && (
            <Row label={`${w.prize} ${ltr(order.prize_code ?? "")}`} value={ltr(`-${money(order.discount, t)}`)} />
          )}
          {!pickup && <Row label={w.delivery} value={money(order.delivery_fee, t)} />}
          <Row label={w.total} value={money(order.total, t)} strong />
          {takesDeposit ? (
            <>
              <Row
                label={paid > 0 ? w.depositPaid : w.depositRequired}
                value={money(paid > 0 ? order.deposit_paid : order.deposit_required, t)}
              />
              {paid > 0 && <Row label={w.balanceDue} value={money(order.balance_due, t)} strong />}
            </>
          ) : (
            <Text size="sm" c="dimmed">
              {w.noDeposit}
            </Text>
          )}
        </Stack>
      </Section>

      {(reviewable || order.deposit.reference || order.deposit.has_proof) && (
        <Section title={w.transfer} tone={status === "DEPOSIT_REVIEW" ? "orange" : undefined}>
          <Stack gap="sm">
            {order.deposit.reference || order.deposit.has_proof ? (
              <>
                {order.deposit.reference && (
                  <Group gap="xs">
                    <Text size="sm" c="dimmed">
                      {w.reference}:
                    </Text>
                    <Text fw={600} ff="monospace">
                      {ltr(order.deposit.reference)}
                    </Text>
                    <CopyButton value={order.deposit.reference}>
                      {({ copied, copy }) => (
                        <Button size="compact-xs" variant="subtle" onClick={copy}>
                          {copied ? w.copied : w.copy}
                        </Button>
                      )}
                    </CopyButton>
                  </Group>
                )}
                {order.deposit.sender && (
                  <Text size="sm">
                    <Text span c="dimmed">
                      {w.sender}:
                    </Text>{" "}
                    {order.deposit.sender}
                  </Text>
                )}
              </>
            ) : (
              <Text size="sm" c="dimmed">
                {w.noReference}
              </Text>
            )}
            {order.duplicate_reference.length > 0 && (
              <Alert color="red">{w.duplicate(order.duplicate_reference.join(", "))}</Alert>
            )}
            {order.deposit.has_proof && <Proof orderId={order.id} version={order.deposit.submitted_at ?? ""} />}
            {reviewable && <ConfirmDeposit order={order} busy={action.isPending} run={run} />}
            {status === "DEPOSIT_REVIEW" && (
              <Button variant="default" fullWidth onClick={() => setDialog("reject")} disabled={action.isPending}>
                {w.reject}
              </Button>
            )}
          </Stack>
        </Section>
      )}

      {inProgress && (
        <Stack gap="xs">
          {status === "CONFIRMED" && (
            <Button size="md" fullWidth loading={action.isPending} onClick={() => void run("status", { status: "PREPARING" })}>
              {w.start}
            </Button>
          )}
          {status === "PREPARING" && (
            <Button size="md" fullWidth loading={action.isPending} onClick={() => void run("status", { status: "READY" })}>
              {w.ready}
            </Button>
          )}
          <Button
            size="md"
            fullWidth
            color="teal"
            variant={status === "READY" ? "filled" : "light"}
            onClick={() => setDialog("complete")}
            disabled={action.isPending}
          >
            {w.complete}
          </Button>
          {status !== "CONFIRMED" && (
            <Button
              variant="subtle"
              size="xs"
              disabled={action.isPending}
              onClick={() => void run("status", { status: status === "READY" ? "PREPARING" : "CONFIRMED" })}
            >
              {status === "READY" ? w.backToPreparing : w.backToConfirmed}
            </Button>
          )}
        </Stack>
      )}

      {status === "COMPLETED" && (
        <Alert color="green" title={`${w.completedReceipt}: ${order.pos.receipt_number}`}>
          <Stack gap="xs">
            <Text size="sm">
              {w.completedBy(order.pos.completed_by)} · {money(order.pos.total, t)}
            </Text>
            {order.pos.order_id && <ReprintButton saleId={order.pos.order_id} />}
          </Stack>
        </Alert>
      )}
      {status === "CANCELLED" && (
        <Alert
          color="red"
          title={`${w.cancelled} ${w.cancelledBy(order.cancel.by === "customer" ? w.customerActor : order.cancel.by)}`}
        >
          {order.cancel.reason}
        </Alert>
      )}

      {order.refund.status === "DUE" && (
        <Refund amount={money(order.refund.amount, t)} busy={action.isPending} onRefund={(reference) => run("refund", { reference })} />
      )}
      {order.refund.status === "DONE" && (
        <Alert color="green" title={w.refundDone(money(order.refund.amount, t))}>
          {order.refund.reference && ltr(order.refund.reference)}
        </Alert>
      )}

      <Section title={w.timeline}>
        <NoteForm busy={action.isPending} onAdd={(message) => run("note", { message })} />
        <Timeline bulletSize={14} lineWidth={2} mt="md">
          {[...order.events].reverse().map((event) => (
            <Timeline.Item key={event.id} title={eventTitle(event, t)} lineVariant={event.public ? "solid" : "dashed"}>
              {event.message && <Text size="sm">{event.message}</Text>}
              <Text size="xs" c="dimmed">
                {event.actor === "customer" ? w.customerActor : event.actor === "system" ? w.systemActor : event.actor}
                {" · "}
                {formatDateTime(event.at)}
              </Text>
            </Timeline.Item>
          ))}
        </Timeline>
      </Section>

      {mayCancel && (
        <Button variant="subtle" color="red" onClick={() => setDialog("cancel")}>
          {w.cancel}
        </Button>
      )}

      <ReasonModal
        opened={dialog === "cancel"}
        title={w.cancelTitle}
        label={w.cancelReason}
        note={paid > 0 ? w.cancelRefundNote(money(order.deposit_paid, t)) : undefined}
        submit={w.cancelConfirm}
        danger
        onClose={() => setDialog(null)}
        onSubmit={(reason) => run("cancel", { reason })}
      />
      <ReasonModal
        opened={dialog === "reject"}
        title={w.rejectTitle}
        label={w.reject}
        placeholder={w.rejectPlaceholder}
        submit={w.rejectSend}
        onClose={() => setDialog(null)}
        onSubmit={(reason) => run("reject-deposit", { reason })}
      />
      <CompleteModal opened={dialog === "complete"} order={order} onClose={() => setDialog(null)} />
    </Stack>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <Group justify="space-between">
      <Text size="sm" fw={strong ? 700 : undefined}>
        {label}
      </Text>
      <Text size="sm" fw={strong ? 700 : undefined}>
        {value}
      </Text>
    </Group>
  );
}

function eventTitle(event: WebOrderEvent, t: Messages): string {
  const w = t.webOrders;
  if (event.kind === "STATUS" && event.data.auto) return w.order.autoConfirmed;
  if (event.kind === "STATUS" && typeof event.data.to === "string") {
    return `${w.events.STATUS}: ${w.status[event.data.to as WebOrderStatus] ?? event.data.to}`;
  }
  if (event.kind === "DEPOSIT_CONFIRMED" && event.data.amount) {
    return `${w.events.DEPOSIT_CONFIRMED} (${event.data.amount})`;
  }
  if (event.kind === "COMPLETED" && event.data.receipt) return `${w.events.COMPLETED} · ${event.data.receipt}`;
  return w.events[event.kind] ?? event.kind;
}

/** The transfer screenshot. Staff only, so it is fetched with the sign-in
 * token and shown from a local address. */
function Proof({ orderId, version }: { orderId: number; version: string }) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    api
      .get<Blob>(`/shop/admin/orders/${orderId}/proof/`, { responseType: "blob" })
      .then((response) => {
        made = URL.createObjectURL(response.data);
        if (live) setUrl(made);
      })
      .catch(() => setUrl(null));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [orderId, version]);
  if (!url) return <Skeleton h={160} />;
  return (
    <Stack gap={4}>
      <Image src={url} alt={t.webOrders.order.proof} radius="sm" mah={360} fit="contain" />
      <Anchor href={url} target="_blank" rel="noreferrer" size="sm">
        <Group gap={4}>
          <IconExternalLink size={14} />
          {t.webOrders.order.openProof}
        </Group>
      </Anchor>
    </Stack>
  );
}

function ConfirmDeposit({
  order,
  busy,
  run,
}: {
  order: WebOrderDetail;
  busy: boolean;
  run: (name: OrderAction, body?: Record<string, unknown>) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const w = t.webOrders.order;
  const action = useOrderAction(order.id);
  const [amount, setAmount] = useState(order.deposit_required);
  const [stockGone, setStockGone] = useState(false);
  const differs = toNumber(amount) !== toNumber(order.deposit_required);

  async function submit() {
    if (stockGone) {
      await run("confirm-deposit", { amount, force: true });
      return;
    }
    try {
      await action.mutateAsync({ action: "confirm-deposit", body: { amount, force: false } });
    } catch (error) {
      if (shopError(error)?.code === "STOCK_GONE") setStockGone(true);
      else notifications.show({ color: "red", message: errorText(error, t) });
    }
  }

  return (
    <Stack gap="xs">
      <TextInput
        label={w.amountReceived}
        description={differs ? w.amountDiffers(money(order.deposit_required, t)) : undefined}
        value={amount}
        onChange={(e) => setAmount(e.currentTarget.value)}
        inputMode="decimal"
        dir="ltr"
      />
      {stockGone && <Alert color="orange">{w.stockGone}</Alert>}
      <Button
        color="teal"
        size="md"
        fullWidth
        loading={busy || action.isPending}
        disabled={toNumber(amount) <= 0}
        onClick={() => void submit()}
      >
        {stockGone ? w.confirmAnyway : w.confirm}
      </Button>
    </Stack>
  );
}

function Refund({ amount, busy, onRefund }: { amount: string; busy: boolean; onRefund: (reference: string) => void }) {
  const { t } = useI18n();
  const w = t.webOrders.order;
  const { isSuperadmin } = useAuth();
  const [reference, setReference] = useState("");
  return (
    <Alert color="orange" title={w.refundDue(amount)}>
      {isSuperadmin ? (
        <Group gap="xs" align="flex-end">
          <TextInput
            value={reference}
            onChange={(e) => setReference(e.currentTarget.value)}
            placeholder={w.refundReference}
            dir="ltr"
            maxLength={120}
            style={{ flex: 1 }}
          />
          <Button loading={busy} onClick={() => onRefund(reference)}>
            {w.markRefunded}
          </Button>
        </Group>
      ) : (
        <Text size="sm">{w.superOnly}</Text>
      )}
    </Alert>
  );
}

function ReprintButton({ saleId }: { saleId: number }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="xs"
      variant="light"
      leftSection={busy ? <Loader size={14} /> : <IconPrinter size={16} />}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const sale = (await api.get<Order>(`/orders/${saleId}/`)).data;
          const result = await printOrderReceipt(sale, { copy: true, openDrawer: false });
          if (!result.success && !result.cancelled) {
            notifications.show({ color: "orange", message: result.error || t.newOrder.receiptFailedHint });
          }
        } catch {
          notifications.show({ color: "red", message: t.common.failed });
        } finally {
          setBusy(false);
        }
      }}
    >
      {t.webOrders.order.printReceipt}
    </Button>
  );
}

function NoteForm({ busy, onAdd }: { busy: boolean; onAdd: (message: string) => Promise<boolean> }) {
  const { t } = useI18n();
  const w = t.webOrders.order;
  const [message, setMessage] = useState("");
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (message.trim() && (await onAdd(message.trim()))) setMessage("");
      }}
    >
      <Group gap="xs" align="flex-end">
        <TextInput
          value={message}
          onChange={(e) => setMessage(e.currentTarget.value)}
          placeholder={w.notePlaceholder}
          aria-label={w.note}
          maxLength={500}
          style={{ flex: 1 }}
        />
        <Button type="submit" variant="light" disabled={busy || !message.trim()}>
          {w.addNote}
        </Button>
      </Group>
    </form>
  );
}

function ReasonModal({
  opened,
  title,
  label,
  placeholder,
  note,
  submit,
  danger,
  onClose,
  onSubmit,
}: {
  opened: boolean;
  title: string;
  label: string;
  placeholder?: string;
  note?: string;
  submit: string;
  danger?: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (opened) setReason("");
  }, [opened]);
  return (
    <Modal opened={opened} onClose={onClose} title={title} centered>
      <Stack>
        <Textarea
          label={label}
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
          placeholder={placeholder}
          minRows={3}
          autosize
          maxLength={255}
          data-autofocus
        />
        {note && <Alert color="orange">{note}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={busy}>
            {t.webOrders.order.back}
          </Button>
          <Button
            color={danger ? "red" : undefined}
            loading={busy}
            disabled={!reason.trim()}
            onClick={async () => {
              setBusy(true);
              const ok = await onSubmit(reason.trim());
              setBusy(false);
              if (ok) onClose();
            }}
          >
            {submit}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
