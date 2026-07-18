import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Grid,
  Group,
  Menu,
  NumberInput,
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
import { PaymentModal, TenderLine } from "../pos/PaymentModal";
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
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [orderDiscount, setOrderDiscount] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [held, setHeld] = useState<HeldSale[]>(loadHeld);
  const [scanValue, setScanValue] = useState("");
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
      notifications.show({ title: "Unknown barcode", message: code, color: "red" });
      return;
    }
    // A weighed item starts at zero — the cashier keys in what the scale says.
    addProduct(found, found.sold_by === "WEIGHT" ? 0 : 1);
    if (found.sold_by === "WEIGHT") {
      notifications.show({
        title: found.name,
        message: `Sold by ${found.unit} — enter the quantity.`,
        color: "blue",
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
      `${cart.length} item${cart.length === 1 ? "" : "s"} · ${total.toFixed(2)}`;
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
    notifications.show({ title: "Sale held", message: label, color: "blue" });
  }

  function resumeSale(sale: HeldSale) {
    if (cart.length > 0) {
      notifications.show({
        title: "Finish or hold the current sale first",
        message: "The till already has items on it.",
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

  async function checkout(payments: TenderLine[]) {
    setSubmitting(true);
    try {
      const resp = await api.post<Order>("/orders/", {
        customer: customerId ? Number(customerId) : null,
        discount: orderDiscount,
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
      });
      const change = Number(resp.data.change_given || 0);
      notifications.show({
        title: `Sale ${resp.data.receipt_number}`,
        message:
          change > 0
            ? `Total ${Number(resp.data.total).toFixed(2)} — change ${change.toFixed(2)}`
            : `Total ${Number(resp.data.total).toFixed(2)}`,
        color: "green",
      });
      await printOrderReceipt(resp.data);
      setPayOpen(false);
      clearSale();
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      qc.invalidateQueries({ queryKey: ["shift"] });
    } catch (err: any) {
      const data = err?.response?.data;
      const detail =
        data?.detail ||
        (Array.isArray(data) ? data.join(" ") : null) ||
        (data && typeof data === "object"
          ? Object.entries(data)
              .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(" ") : v}`)
              .join(" · ")
          : "Checkout failed");
      notifications.show({ title: "Checkout failed", message: detail, color: "red" });
    } finally {
      setSubmitting(false);
    }
  }

  if (shift.isSuccess && !shift.data) {
    return (
      <Stack>
        <Title order={2}>New Order</Title>
        <Alert color="orange" icon={<IconAlertTriangle />} title="No shift is open">
          A till session must be open before you can take payment, so cash is
          accountable to someone.
          <Group mt="md">
            <Button onClick={() => navigate("/shift")}>Open a shift</Button>
          </Group>
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>New Order</Title>
        <Group>
          {shift.data && (
            <Badge size="lg" variant="light">
              Shift {shift.data.number}
            </Badge>
          )}
          {held.length > 0 && (
            <Menu>
              <Menu.Target>
                <Button variant="light" leftSection={<IconPlayerPlay size={16} />}>
                  Held sales ({held.length})
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
                label="Scan barcode"
                placeholder="Scan or type a barcode, then press Enter"
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
                label="Or pick a product"
                placeholder="Search by name"
                searchable
                value={null}
                data={(products.data ?? []).map((p) => ({
                  value: String(p.id),
                  label: `${p.name} — ${Number(p.price).toFixed(2)}/${p.unit} (stock ${p.quantity_in_storage})`,
                }))}
                onChange={addProductById}
              />

              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Product</Table.Th>
                    <Table.Th w={140}>Qty</Table.Th>
                    <Table.Th w={130}>Discount</Table.Th>
                    <Table.Th w={110}>Line</Table.Th>
                    <Table.Th w={50} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {cart.length === 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={5}>
                        <Text c="dimmed" ta="center" py="md">
                          Scan an item to begin.
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
                          <Text>{l.product.name}</Text>
                          <Text size="xs" c="dimmed">
                            {Number(l.product.price).toFixed(2)} / {l.product.unit}
                            {weighed && " · by weight"}
                          </Text>
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
                                ? "Required"
                                : !weighed && !Number.isInteger(l.quantity)
                                  ? "Whole units"
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
                            aria-label="Remove line"
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
                label="Customer (optional)"
                placeholder="Walk-in"
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
                label="Order discount"
                min={0}
                max={subtotal}
                decimalScale={2}
                value={orderDiscount}
                onChange={(v) => setOrderDiscount(Number(v) || 0)}
              />

              <Group justify="space-between">
                <Text c="dimmed">Subtotal</Text>
                <Text>{subtotal.toFixed(2)}</Text>
              </Group>
              <Group justify="space-between">
                <Text size="lg" fw={600}>
                  Total
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
                Take payment
              </Button>
              <Group grow>
                <Button variant="light" onClick={holdSale} disabled={cart.length === 0}>
                  Hold
                </Button>
                <Button variant="default" onClick={clearSale} disabled={cart.length === 0}>
                  Clear
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
        onConfirm={checkout}
      />
    </Stack>
  );
}
