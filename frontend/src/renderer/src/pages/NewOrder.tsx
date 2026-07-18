import {
  ActionIcon,
  Button,
  Card,
  Grid,
  Group,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconTrash } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { api } from "../api/client";
import type { Customer, Order, Paginated, Product } from "../api/types";
import { printOrderReceipt } from "../receipt/receipt";

interface CartLine {
  product: Product;
  quantity: number;
}

export function NewOrder() {
  const qc = useQueryClient();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [payment, setPayment] = useState<string>("CASH");
  const [discount, setDiscount] = useState<number>(0);
  const [tax, setTax] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);

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

  function addProduct(id: string | null) {
    if (!id) return;
    const product = products.data?.find((p) => p.id === Number(id));
    if (!product) return;
    setCart((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (existing) {
        return prev.map((l) =>
          l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  }

  function setQty(id: number, qty: number) {
    setCart((prev) =>
      prev.map((l) => (l.product.id === id ? { ...l, quantity: Math.max(1, qty) } : l))
    );
  }

  function removeLine(id: number) {
    setCart((prev) => prev.filter((l) => l.product.id !== id));
  }

  const subtotal = useMemo(
    () => cart.reduce((s, l) => s + Number(l.product.price) * l.quantity, 0),
    [cart]
  );
  const total = Math.max(0, subtotal - discount + tax);

  async function checkout() {
    if (cart.length === 0) return;
    setSubmitting(true);
    try {
      const resp = await api.post<Order>("/orders/", {
        customer: customerId ? Number(customerId) : null,
        payment_method: payment,
        discount,
        tax,
        items: cart.map((l) => ({ product: l.product.id, quantity: l.quantity })),
      });
      notifications.show({
        title: "Order placed",
        message: `Order #${resp.data.id} — total ${Number(resp.data.total).toFixed(2)}`,
        color: "green",
      });
      await printOrderReceipt(resp.data);
      setCart([]);
      setCustomerId(null);
      setDiscount(0);
      setTax(0);
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
    } catch (err: any) {
      const detail =
        err?.response?.data?.detail ||
        (Array.isArray(err?.response?.data) ? err.response.data.join(" ") : null) ||
        JSON.stringify(err?.response?.data ?? "Checkout failed");
      notifications.show({ title: "Checkout failed", message: detail, color: "red" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Stack>
      <Title order={2}>New Order</Title>
      <Grid>
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Card withBorder radius="md">
            <Select
              label="Add product"
              placeholder="Search by name…"
              searchable
              data={(products.data ?? []).map((p) => ({
                value: String(p.id),
                label: `${p.name} — ${Number(p.price).toFixed(2)} (stock: ${p.quantity_in_storage})`,
              }))}
              value={null}
              onChange={addProduct}
              nothingFoundMessage="No products"
            />
            <Table mt="md" verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Product</Table.Th>
                  <Table.Th w={120}>Qty</Table.Th>
                  <Table.Th>Price</Table.Th>
                  <Table.Th>Total</Table.Th>
                  <Table.Th w={40}></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {cart.map((l) => (
                  <Table.Tr key={l.product.id}>
                    <Table.Td>{l.product.name}</Table.Td>
                    <Table.Td>
                      <NumberInput
                        value={l.quantity}
                        min={1}
                        max={l.product.quantity_in_storage}
                        onChange={(v) => setQty(l.product.id, Number(v) || 1)}
                        size="xs"
                      />
                    </Table.Td>
                    <Table.Td>{Number(l.product.price).toFixed(2)}</Table.Td>
                    <Table.Td>{(Number(l.product.price) * l.quantity).toFixed(2)}</Table.Td>
                    <Table.Td>
                      <ActionIcon color="red" variant="subtle" onClick={() => removeLine(l.product.id)}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
                {cart.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={5}>
                      <Text c="dimmed" ta="center" py="lg">
                        No items yet. Add a product above.
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
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
                data={(customers.data ?? []).map((c) => ({
                  value: String(c.id),
                  label: `${c.name} (${c.phone_number})`,
                }))}
                value={customerId}
                onChange={setCustomerId}
              />
              <Select
                label="Payment method"
                data={[
                  { value: "CASH", label: "Cash" },
                  { value: "CARD", label: "Card" },
                  { value: "OTHER", label: "Other" },
                ]}
                value={payment}
                onChange={(v) => setPayment(v || "CASH")}
              />
              <NumberInput label="Discount" min={0} value={discount} onChange={(v) => setDiscount(Number(v) || 0)} />
              <NumberInput label="Tax" min={0} value={tax} onChange={(v) => setTax(Number(v) || 0)} />

              <Group justify="space-between">
                <Text>Subtotal</Text>
                <Text>{subtotal.toFixed(2)}</Text>
              </Group>
              <Group justify="space-between">
                <Text fw={700} size="lg">
                  Total
                </Text>
                <Text fw={700} size="lg">
                  {total.toFixed(2)}
                </Text>
              </Group>
              <Button
                size="md"
                disabled={cart.length === 0}
                loading={submitting}
                onClick={checkout}
              >
                Checkout & Print
              </Button>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
