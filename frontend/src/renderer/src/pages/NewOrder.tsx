import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Grid,
  Group,
  Menu,
  Modal,
  NumberInput,
  PasswordInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertTriangle,
  IconBarcode,
  IconPlayerPlay,
  IconTrash,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "../api/client";
import type { Customer, Order, Paginated, Product, Shift } from "../api/types";
import { ProductThumb, productThumbUrl } from "../components/ProductThumb";
import { useI18n } from "../i18n";
import { PaymentModal, TenderLine } from "../pos/PaymentModal";
import { enqueue, isOfflineError, newClientUuid } from "../pos/offlineQueue";
import { useScanner } from "../pos/useScanner";
import { printOrderReceipt } from "../receipt/receipt";

interface CartLine {
  product: Product;
  quantity: number;
  discount: number;
}

interface HeldSale {
  id: string;
  label: string;
  cart: CartLine[];
  customerId: string | null;
  heldAt: string;
}

const HELD_KEY = "cashier.heldSales";

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * A receipt for a sale the server has not seen yet.
 *
 * The customer still needs paper, so we synthesise an Order shape locally.
 * It carries no receipt number — that is issued by the server when the queue
 * syncs — and is marked so nobody mistakes it for a filed sale.
 */
function buildOfflineOrder(
  payload: any,
  payments: TenderLine[],
  total: number,
  products: Product[]
): Order {
  return {
    id: 0,
    receipt_number: null,
    customer: payload.customer,
    customer_name: null,
    storage: 0,
    created_by: null,
    created_by_username: null,
    shift: null,
    shift_number: null,
    status: "COMPLETED",
    payment_method: payments[0]?.method ?? "CASH",
    subtotal: String(total + Number(payload.discount || 0)),
    discount: String(payload.discount || 0),
    tax: "0",
    total: String(total),
    amount_paid: String(total),
    change_given: String(
      payments.reduce((s, p) => s + Math.max(0, (p.tendered ?? 0) - p.amount), 0)
    ),
    note: "OFFLINE — awaiting sync",
    items: payload.items.map((line: any, index: number) => {
      const product = products[index];
      return {
        id: index,
        product: line.product,
        product_name: product?.name ?? `Item ${line.product}`,
        product_unit: product?.unit ?? "",
        sold_by: product?.sold_by ?? "UNIT",
        quantity: String(line.quantity),
        unit_price: String(product?.price ?? "0"),
        discount: String(line.discount || 0),
        line_total: String(
          Number(product?.price ?? 0) * Number(line.quantity) - Number(line.discount || 0)
        ),
      };
    }),
    payments: payments.map((p, i) => ({
      id: i,
      method: p.method,
      amount: String(p.amount),
      tendered: String(p.tendered ?? 0),
      change: String(Math.max(0, (p.tendered ?? 0) - p.amount)),
      reference: p.reference ?? "",
      created_at: new Date().toISOString(),
    })),
    created_at: new Date().toISOString(),
  };
}

function loadHeld(): HeldSale[] {
  try {
    return JSON.parse(localStorage.getItem(HELD_KEY) || "[]");
  } catch {
    return [];
  }
}

export function NewOrder() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [orderDiscount, setOrderDiscount] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [held, setHeld] = useState<HeldSale[]>(loadHeld);
  const [scanValue, setScanValue] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [pendingPayments, setPendingPayments] = useState<TenderLine[]>([]);
  const scanRef = useRef<HTMLInputElement>(null);

  const shift = useQuery({
    queryKey: ["shift", "current"],
    queryFn: async () =>
      (await api.get<{ shift: Shift | null }>("/shifts/current/")).data.shift,
  });

  const products = useQuery({
    queryKey: ["products", "active"],
    queryFn: async () =>
      (await api.get<Paginated<Product>>("/products/?is_active=true&page_size=500")).data
        .results,
  });
  const customers = useQuery({
    queryKey: ["customers"],
    queryFn: async () =>
      (await api.get<Paginated<Customer>>("/customers/?page_size=500")).data.results,
  });

  useEffect(() => {
    localStorage.setItem(HELD_KEY, JSON.stringify(held));
  }, [held]);

  // Keep the scan box focused so a scan always lands somewhere useful.
  useEffect(() => {
    if (!payOpen) scanRef.current?.focus();
  }, [payOpen, cart.length]);

  function addProductById(id: string | null) {
    if (!id) return;
    const product = products.data?.find((p) => p.id === Number(id));
    if (product) addProduct(product);
  }

  function addProduct(product: Product, quantity = 1) {
    setCart((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (existing) {
        return prev.map((l) =>
          l.product.id === product.id ? { ...l, quantity: l.quantity + quantity } : l
        );
      }
      return [...prev, { product, quantity, discount: 0 }];
    });
  }

  async function handleScan(code: string) {
    setScanValue("");
    const local = products.data?.find((p) => p.barcode === code);
    const found =
      local ??
      (await api
        .get<Product>(`/products/lookup/?barcode=${encodeURIComponent(code)}`)
        .then((r) => r.data)
        .catch(() => null));

    if (!found) {
      notifications.show({ title: t.newOrder.unknownBarcode, message: code, color: "red" });
      return;
    }
    // A weighed item starts at zero — the cashier keys in what the scale says.
    addProduct(found, found.sold_by === "WEIGHT" ? 0 : 1);
    if (found.sold_by === "WEIGHT") {
      notifications.show({
        title: found.name,
        message: t.newOrder.weighedHint(found.unit),
        color: "teal",
      });
    }
  }

  useScanner(handleScan, { enabled: !payOpen });

  function setQty(id: number, qty: number) {
    setCart((prev) =>
      prev.map((l) => (l.product.id === id ? { ...l, quantity: Math.max(0, qty) } : l))
    );
  }

  function setLineDiscount(id: number, value: number) {
    setCart((prev) =>
      prev.map((l) => (l.product.id === id ? { ...l, discount: Math.max(0, value) } : l))
    );
  }

  function removeLine(id: number) {
    setCart((prev) => prev.filter((l) => l.product.id !== id));
  }

  const subtotal = useMemo(
    () =>
      round2(
        cart.reduce((s, l) => s + Number(l.product.price) * l.quantity - l.discount, 0)
      ),
    [cart]
  );
  const total = round2(Math.max(0, subtotal - orderDiscount));

  function clearSale() {
    setCart([]);
    setCustomerId(null);
    setOrderDiscount(0);
  }

  function holdSale() {
    if (cart.length === 0) return;
    const label =
      customers.data?.find((c) => String(c.id) === customerId)?.name ||
      t.newOrder.heldLabel(cart.length, total.toFixed(2));
    setHeld((prev) => [
      ...prev,
      {
        id: String(Date.now()),
        label,
        cart,
        customerId,
        heldAt: new Date().toISOString(),
      },
    ]);
    clearSale();
    notifications.show({ title: t.newOrder.saleHeld, message: label, color: "teal" });
  }

  function resumeSale(sale: HeldSale) {
    if (cart.length > 0) {
      notifications.show({
        title: t.newOrder.busyTitle,
        message: t.newOrder.busyMessage,
        color: "orange",
      });
      return;
    }
    setCart(sale.cart);
    setCustomerId(sale.customerId);
    setHeld((prev) => prev.filter((h) => h.id !== sale.id));
  }

  const invalidLines = cart.filter(
    (l) =>
      l.quantity <= 0 ||
      (l.product.sold_by === "UNIT" && !Number.isInteger(l.quantity))
  );

  async function checkout(payments: TenderLine[], pin = "") {
    setSubmitting(true);
    // Minted before the first attempt so a retry — or an offline replay —
    // cannot ring the same sale up twice.
    const clientUuid = newClientUuid();
    const payload = {
      customer: customerId ? Number(customerId) : null,
      discount: orderDiscount,
      override_pin: pin,
      client_uuid: clientUuid,
      items: cart.map((l) => ({
        product: l.product.id,
        quantity: l.quantity,
        discount: l.discount,
      })),
      payments: payments.map((p) => ({
        method: p.method,
        amount: p.amount,
        tendered: p.tendered ?? 0,
        reference: p.reference ?? "",
      })),
    };
    try {
      const resp = await api.post<Order>("/orders/", payload);
      const change = Number(resp.data.change_given || 0);
      notifications.show({
        title: t.newOrder.saleDone(resp.data.receipt_number ?? ""),
        message: t.newOrder.saleTotal(
          Number(resp.data.total).toFixed(2),
          change > 0 ? change.toFixed(2) : undefined
        ),
        color: "green",
      });
      await printOrderReceipt(resp.data);
      setPayOpen(false);
      clearSale();
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      qc.invalidateQueries({ queryKey: ["shift"] });
    } catch (err: any) {
      // Network down: bank the sale locally rather than losing it. The
      // customer is served now and the queue syncs when the link returns.
      if (isOfflineError(err)) {
        enqueue(clientUuid, payload);
        const offlineOrder = buildOfflineOrder(
          payload, payments, total, cart.map((l) => l.product)
        );
        notifications.show({
          title: t.newOrder.savedOffline,
          message: t.newOrder.savedOfflineMessage,
          color: "yellow",
        });
        await printOrderReceipt(offlineOrder);
        setPayOpen(false);
        clearSale();
        setSubmitting(false);
        return;
      }
      const data = err?.response?.data;
      // The server decides what counts as a "large" discount; when it asks for
      // a supervisor we prompt rather than duplicating the threshold here.
      if (data?.override_pin) {
        setPendingPayments(payments);
        setPinOpen(true);
        setSubmitting(false);
        if (pin) {
          notifications.show({
            title: t.newOrder.pinRejected,
            message: String(data.override_pin),
            color: "red",
          });
        }
        return;
      }
      const detail =
        data?.detail ||
        (Array.isArray(data) ? data.join(" ") : null) ||
        (data && typeof data === "object"
          ? Object.entries(data)
              .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(" ") : v}`)
              .join(" · ")
          : t.newOrder.checkoutFailed);
      notifications.show({ title: t.newOrder.checkoutFailed, message: detail, color: "red" });
    } finally {
      setSubmitting(false);
    }
  }

  if (shift.isSuccess && !shift.data) {
    return (
      <Stack>
        <Title order={2}>{t.nav.newOrder}</Title>
        <Alert color="orange" icon={<IconAlertTriangle />} title={t.newOrder.noShiftTitle}>
          {t.newOrder.noShiftBody}
          <Group mt="md">
            <Button onClick={() => navigate("/shift")}>{t.newOrder.openShift}</Button>
          </Group>
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t.nav.newOrder}</Title>
        <Group>
          {shift.data && (
            <Badge size="lg" variant="light">
              {t.shift.title(shift.data.number)}
            </Badge>
          )}
          {held.length > 0 && (
            <Menu>
              <Menu.Target>
                <Button variant="light" leftSection={<IconPlayerPlay size={16} />}>
                  {t.newOrder.heldSales(held.length)}
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                {held.map((h) => (
                  <Menu.Item key={h.id} onClick={() => resumeSale(h)}>
                    {h.label}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
      </Group>

      <Grid>
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Card withBorder radius="md">
            <Stack>
              <TextInput
                ref={scanRef}
                data-scan="true"
                label={t.newOrder.scanLabel}
                placeholder={t.newOrder.scanPlaceholder}
                leftSection={<IconBarcode size={18} />}
                value={scanValue}
                onChange={(e) => setScanValue(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && scanValue.trim()) {
                    e.preventDefault();
                    handleScan(scanValue.trim());
                  }
                }}
              />
              <Select
                label={t.newOrder.pickLabel}
                placeholder={t.newOrder.pickPlaceholder}
                searchable
                value={null}
                data={(products.data ?? []).map((p) => ({
                  value: String(p.id),
                  label: t.newOrder.productOption(
                    p.name,
                    Number(p.price).toFixed(2),
                    p.unit,
                    p.quantity_in_storage
                  ),
                }))}
                onChange={addProductById}
              />

              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t.newOrder.product}</Table.Th>
                    <Table.Th w={140}>{t.common.qty}</Table.Th>
                    <Table.Th w={130}>{t.common.discount}</Table.Th>
                    <Table.Th w={110}>{t.common.line}</Table.Th>
                    <Table.Th w={50} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {cart.length === 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={5}>
                        <Text c="dimmed" ta="center" py="md">
                          {t.newOrder.emptyCart}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                  {cart.map((l) => {
                    const weighed = l.product.sold_by === "WEIGHT";
                    const lineTotal = round2(
                      Number(l.product.price) * l.quantity - l.discount
                    );
                    return (
                      <Table.Tr key={l.product.id}>
                        <Table.Td>
                          <Group gap="sm" wrap="nowrap">
                            <ProductThumb src={productThumbUrl(l.product.image_url)} size={40} />
                            <div>
                              <Text>{l.product.name}</Text>
                              <Text size="xs" c="dimmed">
                                {Number(l.product.price).toFixed(2)} / {l.product.unit}
                                {weighed && t.newOrder.byWeight}
                              </Text>
                            </div>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <NumberInput
                            min={0}
                            step={weighed ? 0.1 : 1}
                            decimalScale={weighed ? 3 : 0}
                            value={l.quantity}
                            onChange={(v) => setQty(l.product.id, Number(v) || 0)}
                            error={
                              l.quantity <= 0
                                ? t.newOrder.qtyRequired
                                : !weighed && !Number.isInteger(l.quantity)
                                  ? t.newOrder.wholeUnits
                                  : undefined
                            }
                          />
                        </Table.Td>
                        <Table.Td>
                          <NumberInput
                            min={0}
                            decimalScale={2}
                            value={l.discount}
                            onChange={(v) => setLineDiscount(l.product.id, Number(v) || 0)}
                          />
                        </Table.Td>
                        <Table.Td>{lineTotal.toFixed(2)}</Table.Td>
                        <Table.Td>
                          <ActionIcon
                            color="red"
                            variant="subtle"
                            onClick={() => removeLine(l.product.id)}
                            aria-label={t.newOrder.removeLine}
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Stack>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 4 }}>
          <Card withBorder radius="md">
            <Stack>
              <Select
                label={t.newOrder.customerLabel}
                placeholder={t.common.walkIn}
                searchable
                clearable
                value={customerId}
                data={(customers.data ?? []).map((c) => ({
                  value: String(c.id),
                  label: c.name,
                }))}
                onChange={setCustomerId}
              />
              <NumberInput
                label={t.newOrder.orderDiscount}
                min={0}
                max={subtotal}
                decimalScale={2}
                value={orderDiscount}
                onChange={(v) => setOrderDiscount(Number(v) || 0)}
              />

              <Group justify="space-between">
                <Text c="dimmed">{t.common.subtotal}</Text>
                <Text>{subtotal.toFixed(2)}</Text>
              </Group>
              <Group justify="space-between">
                <Text size="lg" fw={600}>
                  {t.common.total}
                </Text>
                <Text size="xl" fw={700}>
                  {total.toFixed(2)}
                </Text>
              </Group>

              <Button
                size="lg"
                disabled={cart.length === 0 || invalidLines.length > 0}
                onClick={() => setPayOpen(true)}
              >
                {t.newOrder.takePayment}
              </Button>
              <Group grow>
                <Button variant="light" onClick={holdSale} disabled={cart.length === 0}>
                  {t.newOrder.hold}
                </Button>
                <Button variant="default" onClick={clearSale} disabled={cart.length === 0}>
                  {t.newOrder.clear}
                </Button>
              </Group>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>

      <PaymentModal
        opened={payOpen}
        total={total}
        submitting={submitting}
        onClose={() => setPayOpen(false)}
        onConfirm={(payments) => checkout(payments)}
      />

      <Modal
        opened={pinOpen}
        onClose={() => setPinOpen(false)}
        title={t.newOrder.pinTitle}
        centered
      >
        <Stack>
          <Text size="sm" c="dimmed">
            {t.newOrder.pinBody}
          </Text>
          <PasswordInput
            label={t.common.managerPin}
            value={pin}
            onChange={(e) => setPin(e.currentTarget.value)}
            data-autofocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && pin.trim()) {
                setPinOpen(false);
                checkout(pendingPayments, pin);
                setPin("");
              }
            }}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setPinOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              disabled={!pin.trim()}
              onClick={() => {
                setPinOpen(false);
                checkout(pendingPayments, pin);
                setPin("");
              }}
            >
              {t.newOrder.authorise}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
