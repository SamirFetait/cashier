import {
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
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { IconButton } from "../components/IconButton";
import { ProductThumb, productThumbUrl } from "../components/ProductThumb";
import { useI18n } from "../i18n";
import { PaymentModal } from "../pos/PaymentModal";
import { PinPrompt } from "../pos/PinPrompt";
import { useScanner } from "../pos/useScanner";
import { lineTotal, useSale } from "../pos/useSale";

export function NewOrder() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [payOpen, setPayOpen] = useState(false);
  const [scanValue, setScanValue] = useState("");
  const scanRef = useRef<HTMLInputElement>(null);
  const sale = useSale({ onCompleted: () => setPayOpen(false) });
  const { cart, products, customers, shift, held, subtotal, total } = sale;

  // Keep the scan box focused so a scan always lands somewhere useful.
  useEffect(() => {
    if (!payOpen) scanRef.current?.focus();
  }, [payOpen, cart.length]);

  function addProductById(id: string | null) {
    if (!id) return;
    const product = products.data?.find((p) => p.id === Number(id));
    if (product) sale.addProduct(product);
  }

  async function handleScan(code: string) {
    setScanValue("");
    const found = await sale.findByBarcode(code);

    if (!found) {
      notifications.show({ title: t.newOrder.unknownBarcode, message: code, color: "red" });
      return;
    }
    // A weighed item starts at zero — the cashier keys in what the scale says.
    sale.addProduct(found, found.sold_by === "WEIGHT" ? 0 : 1);
    if (found.sold_by === "WEIGHT") {
      notifications.show({
        title: found.name,
        message: t.newOrder.weighedHint(found.unit),
        color: "teal",
      });
    }
  }

  useScanner(handleScan, { enabled: !payOpen });

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
                  <Menu.Item key={h.id} onClick={() => sale.resumeSale(h)}>
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
                            onChange={(v) => sale.setQty(l.product.id, Number(v) || 0)}
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
                            onChange={(v) => sale.setLineDiscount(l.product.id, Number(v) || 0)}
                          />
                        </Table.Td>
                        <Table.Td>{lineTotal(l).toFixed(2)}</Table.Td>
                        <Table.Td>
                          <IconButton
                            label={t.newOrder.removeLine}
                            color="red"
                            variant="subtle"
                            onClick={() => sale.removeLine(l.product.id)}
                          >
                            <IconTrash size={16} />
                          </IconButton>
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
                value={sale.customerId}
                data={(customers.data ?? []).map((c) => ({
                  value: String(c.id),
                  label: c.name,
                }))}
                onChange={sale.setCustomerId}
              />
              <NumberInput
                label={t.newOrder.orderDiscount}
                min={0}
                max={subtotal}
                decimalScale={2}
                value={sale.orderDiscount}
                onChange={(v) => sale.setOrderDiscount(Number(v) || 0)}
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
                disabled={cart.length === 0 || sale.invalidLines.length > 0}
                onClick={() => setPayOpen(true)}
              >
                {t.newOrder.takePayment}
              </Button>
              <Group grow>
                <Button variant="light" onClick={sale.holdSale} disabled={cart.length === 0}>
                  {t.newOrder.hold}
                </Button>
                <Button variant="default" onClick={sale.clearSale} disabled={cart.length === 0}>
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
        submitting={sale.submitting}
        onClose={() => setPayOpen(false)}
        onConfirm={(payments) => sale.checkout(payments)}
      />
      <PinPrompt opened={sale.pin.opened} onClose={sale.pin.close} onSubmit={sale.pin.submit} />
    </Stack>
  );
}
