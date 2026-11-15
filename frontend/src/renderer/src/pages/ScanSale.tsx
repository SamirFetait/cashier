import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Collapse,
  Divider,
  Grid,
  Group,
  Kbd,
  Menu,
  Modal,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  UnstyledButton,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconBarcode,
  IconChevronDown,
  IconCircleCheck,
  IconMinus,
  IconPlayerPlay,
  IconPlus,
  IconScan,
  IconTrash,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "../api/client";
import type { Order, Product } from "../api/types";
import { IconButton } from "../components/IconButton";
import { ProductThumb, productThumbUrl } from "../components/ProductThumb";
import { useI18n } from "../i18n";
import { PaymentModal } from "../pos/PaymentModal";
import { PinPrompt } from "../pos/PinPrompt";
import { useScanner } from "../pos/useScanner";
import { lineTotal, useSale } from "../pos/useSale";

/** Anything bigger is a barcode that landed in the quantity box, not a quantity. */
const MAX_QUANTITY = 10000;

type ScanStatus =
  | { kind: "ready" }
  | { kind: "added"; product: Product }
  | { kind: "notFound"; code: string };

interface QuantityEdit {
  product: Product;
  /** "add" puts a newly scanned (weighed) item on the invoice; "set" corrects a line. */
  mode: "add" | "set";
}

function qtyText(n: number): string {
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(3)));
}

/** A short low buzz: the scanner beeps on every read, so only a failed lookup needs a sound. */
function playErrorTone() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 220;
    gain.gain.value = 0.06;
    osc.connect(gain).connect(ctx.destination);
    osc.onended = () => void ctx.close();
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch {
    /* no audio output */
  }
}

/**
 * The till screen built around the barcode scanner: every scan lands on the
 * invoice at once, the last item read is shown large, and the total and the
 * pay button stay in view.
 */
export function ScanSale() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [payOpen, setPayOpen] = useState(false);
  const [code, setCode] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ScanStatus>({ kind: "ready" });
  const [lastId, setLastId] = useState<number | null>(null);
  const [quantityEdit, setQuantityEdit] = useState<QuantityEdit | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [lastSale, setLastSale] = useState<{ order: Order; offline: boolean } | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const sale = useSale({
    onCompleted: (order, offline) => {
      setPayOpen(false);
      setLastSale({ order, offline });
      setStatus({ kind: "ready" });
      setLastId(null);
    },
  });
  const { cart, shift, products, subtotal, total } = sale;

  const nextNumber = useQuery({
    queryKey: ["orders", "next-number"],
    queryFn: async () =>
      (await api.get<{ receipt_number: string }>("/orders/next-number/")).data.receipt_number,
    // Another till may take the number; keep the preview fresh.
    refetchInterval: 30_000,
  });

  const anyModal = payOpen || quantityEdit !== null || clearOpen || sale.pin.opened;
  const canPay = cart.length > 0 && sale.invalidLines.length === 0;

  // Keep the code box focused, so a scan or a typed code always lands there.
  useEffect(() => {
    if (!anyModal) codeRef.current?.focus();
  }, [anyModal, cart.length, status]);

  function addScanned(product: Product) {
    setLastSale(null);
    // A weighed item needs the scale's reading before it goes on the invoice.
    if (product.sold_by === "WEIGHT") {
      setQuantityEdit({ product, mode: "add" });
      return;
    }
    sale.addProduct(product, 1);
    setLastId(product.id);
    setStatus({ kind: "added", product });
  }

  async function handleCode(raw: string) {
    const value = raw.trim();
    setCode("");
    if (!value) return;
    const product = await sale.findByBarcode(value);
    if (!product) {
      setStatus({ kind: "notFound", code: value });
      playErrorTone();
      return;
    }
    addScanned(product);
  }

  // Scans while the focus is elsewhere (after a click on a button, say).
  useScanner(handleCode, { enabled: !anyModal });

  // F9 takes payment.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "F9" && !anyModal && canPay) {
        event.preventDefault();
        setPayOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [anyModal, canPay]);

  function confirmQuantity(quantity: number) {
    if (!quantityEdit) return;
    const { product, mode } = quantityEdit;
    if (mode === "add") sale.addProduct(product, quantity);
    else sale.setQty(product.id, quantity);
    setLastId(product.id);
    setStatus({ kind: "added", product });
    setQuantityEdit(null);
  }

  function removeLine(id: number) {
    sale.removeLine(id);
    if (lastId === id) setLastId(null);
    if (status.kind === "added" && status.product.id === id) setStatus({ kind: "ready" });
  }

  if (shift.isSuccess && !shift.data) {
    return (
      <Stack>
        <Title order={2}>{t.nav.scan}</Title>
        <Alert color="orange" icon={<IconAlertTriangle />} title={t.newOrder.noShiftTitle}>
          {t.newOrder.noShiftBody}
          <Group mt="md">
            <Button onClick={() => navigate("/shift")}>{t.newOrder.openShift}</Button>
          </Group>
        </Alert>
      </Stack>
    );
  }

  const lastLine = status.kind === "added" ? cart.find((l) => l.product.id === status.product.id) : undefined;
  // Newest line on top, where the eye is after a scan.
  const lines = cart.map((line, index) => ({ line, number: index + 1 })).reverse();

  return (
    <Grid gutter="md">
      <Grid.Col span={{ base: 12, md: 8 }}>
        <Stack>
          <Card withBorder radius="md" p="md">
            <Stack gap="md">
              <StatusBanner status={status} lastLine={lastLine} />
              <Group align="flex-start" grow preventGrowOverflow={false}>
                <TextInput
                  ref={codeRef}
                  data-scan="true"
                  size="md"
                  aria-label={t.scan.codePlaceholder}
                  placeholder={t.scan.codePlaceholder}
                  leftSection={<IconBarcode size={20} />}
                  value={code}
                  onChange={(e) => setCode(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && code.trim()) {
                      e.preventDefault();
                      void handleCode(code);
                    }
                  }}
                />
                <Select
                  size="md"
                  aria-label={t.scan.searchPlaceholder}
                  placeholder={t.scan.searchPlaceholder}
                  searchable
                  value={null}
                  searchValue={search}
                  onSearchChange={setSearch}
                  data={(products.data ?? []).map((p) => ({
                    value: String(p.id),
                    label: `${p.name} — ${Number(p.price).toFixed(2)}`,
                  }))}
                  onChange={(id) => {
                    const product = products.data?.find((p) => String(p.id) === id);
                    setSearch("");
                    if (product) addScanned(product);
                  }}
                />
              </Group>
            </Stack>
          </Card>

          <Card withBorder radius="md" p={0}>
            {cart.length === 0 ? (
              <Center py={56} px="md">
                <Stack align="center" gap={6}>
                  <ThemeIcon size={64} radius="xl" variant="light">
                    <IconScan size={36} />
                  </ThemeIcon>
                  <Text fw={600} size="lg">
                    {t.scan.emptyTitle}
                  </Text>
                  <Text c="dimmed" size="sm" ta="center">
                    {t.scan.emptyBody}
                  </Text>
                </Stack>
              </Center>
            ) : (
              <Table verticalSpacing="sm" fz="md" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={44}>#</Table.Th>
                    <Table.Th>{t.common.item}</Table.Th>
                    <Table.Th w={170} ta="center">
                      {t.common.qty}
                    </Table.Th>
                    <Table.Th w={110}>{t.common.total}</Table.Th>
                    <Table.Th w={52} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {lines.map(({ line, number }) => {
                    const weighed = line.product.sold_by === "WEIGHT";
                    const invalid = sale.invalidLines.includes(line);
                    return (
                      <Table.Tr
                        key={line.product.id}
                        bg={line.product.id === lastId ? "var(--mantine-primary-color-light)" : undefined}
                      >
                        <Table.Td c="dimmed">{number}</Table.Td>
                        <Table.Td>
                          <Group gap="sm" wrap="nowrap">
                            <ProductThumb src={productThumbUrl(line.product.image_url)} size={40} />
                            <div>
                              <Text fw={500}>{line.product.name}</Text>
                              <Text size="xs" c="dimmed">
                                {Number(line.product.price).toFixed(2)} / {line.product.unit}
                                {weighed && t.newOrder.byWeight}
                              </Text>
                            </div>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={6} justify="center" wrap="nowrap">
                            {!weighed && (
                              <ActionIcon
                                variant="default"
                                size="lg"
                                aria-label={t.scan.decrease}
                                disabled={line.quantity <= 1}
                                onClick={() => sale.setQty(line.product.id, line.quantity - 1)}
                              >
                                <IconMinus size={16} />
                              </ActionIcon>
                            )}
                            <UnstyledButton
                              aria-label={t.scan.editQuantity}
                              onClick={() => setQuantityEdit({ product: line.product, mode: "set" })}
                              px="xs"
                              miw={44}
                              style={{ textAlign: "center", borderRadius: 4 }}
                            >
                              <Text fw={700} c={invalid ? "red" : undefined} dir="ltr">
                                {qtyText(line.quantity)}
                                {weighed ? ` ${line.product.unit}` : ""}
                              </Text>
                            </UnstyledButton>
                            {!weighed && (
                              <ActionIcon
                                variant="default"
                                size="lg"
                                aria-label={t.scan.increase}
                                onClick={() => sale.setQty(line.product.id, line.quantity + 1)}
                              >
                                <IconPlus size={16} />
                              </ActionIcon>
                            )}
                          </Group>
                        </Table.Td>
                        <Table.Td fw={600}>{lineTotal(line).toFixed(2)}</Table.Td>
                        <Table.Td>
                          <IconButton
                            label={t.newOrder.removeLine}
                            color="red"
                            variant="subtle"
                            onClick={() => removeLine(line.product.id)}
                          >
                            <IconTrash size={16} />
                          </IconButton>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            )}
          </Card>
        </Stack>
      </Grid.Col>

      <Grid.Col span={{ base: 12, md: 4 }}>
        <Stack
          style={{
            position: "sticky",
            top: "calc(var(--app-shell-header-offset, 0px) + var(--mantine-spacing-md))",
          }}
        >
          <Card withBorder radius="md" p="lg">
            <Stack gap="sm">
              <Group justify="space-between" wrap="nowrap">
                <Title order={3}>
                  {nextNumber.data ? t.scan.invoice(nextNumber.data) : t.scan.newInvoice}
                </Title>
                {shift.data && (
                  <Badge variant="light" size="lg">
                    {t.shift.title(shift.data.number)}
                  </Badge>
                )}
              </Group>
              <Text c="dimmed" size="sm">
                {t.scan.itemCount(cart.length)}
              </Text>
              <Divider />
              {(sale.orderDiscount > 0 || cart.some((l) => l.discount > 0)) && (
                <Group justify="space-between">
                  <Text c="dimmed">{t.common.subtotal}</Text>
                  <Text>{subtotal.toFixed(2)}</Text>
                </Group>
              )}
              {sale.orderDiscount > 0 && (
                <Group justify="space-between">
                  <Text c="dimmed">{t.common.discount}</Text>
                  <Text dir="ltr">-{sale.orderDiscount.toFixed(2)}</Text>
                </Group>
              )}
              <Group justify="space-between" align="baseline">
                <Text size="lg" fw={600}>
                  {t.common.total}
                </Text>
                <Text fz={44} fw={800} lh={1.1} c="teal">
                  {total.toFixed(2)}
                </Text>
              </Group>
              <Button
                size="xl"
                fullWidth
                disabled={!canPay}
                onClick={() => setPayOpen(true)}
                rightSection={<Kbd>F9</Kbd>}
              >
                {t.scan.pay}
              </Button>
              <Group grow>
                <Button variant="light" onClick={sale.holdSale} disabled={cart.length === 0}>
                  {t.newOrder.hold}
                </Button>
                <Button variant="default" onClick={() => setClearOpen(true)} disabled={cart.length === 0}>
                  {t.newOrder.clear}
                </Button>
              </Group>
              {sale.held.length > 0 && (
                <Menu>
                  <Menu.Target>
                    <Button variant="subtle" leftSection={<IconPlayerPlay size={16} />}>
                      {t.newOrder.heldSales(sale.held.length)}
                    </Button>
                  </Menu.Target>
                  <Menu.Dropdown>
                    {sale.held.map((h) => (
                      <Menu.Item key={h.id} onClick={() => sale.resumeSale(h)}>
                        {h.label}
                      </Menu.Item>
                    ))}
                  </Menu.Dropdown>
                </Menu>
              )}
              <UnstyledButton onClick={() => setMoreOpen((o) => !o)}>
                <Group gap={4}>
                  <Text size="sm" c="dimmed">
                    {t.scan.more}
                  </Text>
                  <IconChevronDown
                    size={14}
                    style={{ transform: moreOpen ? "rotate(180deg)" : undefined, transition: "transform 150ms" }}
                  />
                </Group>
              </UnstyledButton>
              <Collapse in={moreOpen}>
                <Stack gap="xs">
                  <Select
                    label={t.newOrder.customerLabel}
                    placeholder={t.common.walkIn}
                    searchable
                    clearable
                    value={sale.customerId}
                    data={(sale.customers.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
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
                </Stack>
              </Collapse>
            </Stack>
          </Card>

          {lastSale && cart.length === 0 && (
            <Alert
              color={lastSale.offline ? "yellow" : "green"}
              icon={<IconCircleCheck />}
              title={
                lastSale.offline
                  ? t.newOrder.savedOffline
                  : t.scan.paid(lastSale.order.receipt_number ?? "")
              }
            >
              <Stack gap={4}>
                <Text fw={700} size="lg">
                  {t.common.total}: {Number(lastSale.order.total).toFixed(2)}
                </Text>
                {Number(lastSale.order.change_given) > 0 && (
                  <Text fw={700} size="lg">
                    {t.scan.change(Number(lastSale.order.change_given).toFixed(2))}
                  </Text>
                )}
                {lastSale.offline && <Text size="sm">{t.newOrder.savedOfflineMessage}</Text>}
                <Text size="sm" c="dimmed">
                  {t.scan.nextHint}
                </Text>
              </Stack>
            </Alert>
          )}
        </Stack>
      </Grid.Col>

      <PaymentModal
        opened={payOpen}
        total={total}
        submitting={sale.submitting}
        onClose={() => setPayOpen(false)}
        onConfirm={(payments) => sale.checkout(payments)}
      />
      <PinPrompt opened={sale.pin.opened} onClose={sale.pin.close} onSubmit={sale.pin.submit} />
      <QuantityPrompt
        edit={quantityEdit}
        current={quantityEdit ? cart.find((l) => l.product.id === quantityEdit.product.id)?.quantity ?? 0 : 0}
        onClose={() => setQuantityEdit(null)}
        onConfirm={confirmQuantity}
      />
      <Modal opened={clearOpen} onClose={() => setClearOpen(false)} title={t.scan.clearTitle} centered>
        <Stack>
          <Text size="sm">{t.scan.clearBody}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setClearOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              color="red"
              data-autofocus
              onClick={() => {
                sale.clearSale();
                setStatus({ kind: "ready" });
                setLastId(null);
                setClearOpen(false);
              }}
            >
              {t.scan.clearConfirm}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Grid>
  );
}

function StatusBanner({
  status,
  lastLine,
}: {
  status: ScanStatus;
  lastLine: { quantity: number; product: Product } | undefined;
}) {
  const { t } = useI18n();

  if (status.kind === "notFound") {
    return (
      <Alert color="red" variant="filled" icon={<IconAlertTriangle size={28} />} title={t.scan.notFound(status.code)}>
        {t.scan.notFoundHint}
      </Alert>
    );
  }

  if (status.kind === "added" && lastLine) {
    const product = lastLine.product;
    const weighed = product.sold_by === "WEIGHT";
    return (
      <Group wrap="nowrap" gap="md" p="sm" bg="var(--mantine-primary-color-light)" style={{ borderRadius: 8 }}>
        <ProductThumb src={productThumbUrl(product.image_url)} size={64} />
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Text size="xs" c="dimmed">
            {t.scan.lastScanned}
          </Text>
          <Text fz={24} fw={700} lh={1.2} truncate>
            {product.name}
          </Text>
          <Text c="dimmed">
            {Number(product.price).toFixed(2)} × {qtyText(lastLine.quantity)}
            {weighed ? ` ${product.unit}` : ""}
          </Text>
        </Stack>
        <Text fz={28} fw={800}>
          {lineTotal({ ...lastLine, discount: 0 }).toFixed(2)}
        </Text>
      </Group>
    );
  }

  return (
    <Group wrap="nowrap" gap="md">
      <ThemeIcon size={56} radius="md" variant="light">
        <IconScan size={32} />
      </ThemeIcon>
      <div>
        <Text fz={22} fw={700}>
          {t.scan.ready}
        </Text>
        <Text c="dimmed" size="sm">
          {t.scan.readyHint}
        </Text>
      </div>
    </Group>
  );
}

function QuantityPrompt({
  edit,
  current,
  onClose,
  onConfirm,
}: {
  edit: QuantityEdit | null;
  current: number;
  onClose: () => void;
  onConfirm: (quantity: number) => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState<number | "">("");

  useEffect(() => {
    if (edit) setValue(edit.mode === "set" && current > 0 ? current : "");
  }, [edit, current]);

  const weighed = edit?.product.sold_by === "WEIGHT";
  const n = typeof value === "number" ? value : 0;
  const error =
    value === ""
      ? null
      : n > MAX_QUANTITY
        ? t.scan.quantityTooLarge
        : n <= 0
          ? t.scan.quantityInvalid
          : !weighed && !Number.isInteger(n)
            ? t.newOrder.wholeUnits
            : null;
  const valid = value !== "" && !error;

  function submit() {
    if (valid) onConfirm(n);
  }

  return (
    <Modal
      opened={edit !== null}
      onClose={onClose}
      centered
      title={edit ? (weighed ? t.scan.weightTitle(edit.product.name) : t.scan.quantityTitle(edit.product.name)) : ""}
    >
      <Stack>
        <NumberInput
          data-autofocus
          size="xl"
          label={weighed && edit ? t.scan.weightLabel(edit.product.unit) : t.scan.quantityLabel}
          min={0}
          decimalScale={weighed ? 3 : 0}
          allowDecimal={weighed}
          value={value}
          onChange={(v) => setValue(v === "" ? "" : Number(v))}
          error={error}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button disabled={!valid} onClick={submit}>
            {t.scan.confirm}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
