import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Grid,
  Group,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconBarcode, IconPlus, IconPrinter, IconSearch } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import type { Paginated, Product, Storage } from "../api/types";
import { CategorySelect } from "../components/CategorySelect";
import { IconButton } from "../components/IconButton";
import { ProductThumb, productThumbUrl } from "../components/ProductThumb";
import { useI18n } from "../i18n";
import { barcodeFits, buildLabelsHtml, type LabelContent, type LabelPage } from "../labels/labelHtml";
import { LABEL_SIZES, loadLabelSettings, saveLabelSettings, type LabelSettings } from "../labels/settings";
import { platform } from "../platform";

const PRINT_DIALOG = "print-dialog";
const CUSTOM_SIZE = "custom";
const MAX_COPIES = 500;
/** CSS pixels per millimetre, for sizing the preview frame. */
const PX_PER_MM = 96 / 25.4;
const PREVIEW_WIDTH_PX = 300;

const sizeKey = (s: { widthMm: number; heightMm: number }) => `${s.widthMm}x${s.heightMm}`;

function serverMessage(err: unknown, fallback: string): string {
  const data = (err as any)?.response?.data;
  if (!data) return fallback;
  if (typeof data.detail === "string") return data.detail;
  const first = Object.values(data)[0];
  return Array.isArray(first) ? String(first[0]) : fallback;
}

export function Labels() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [settings, setSettings] = useState<LabelSettings>(loadLabelSettings);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [copies, setCopies] = useState<Record<number, number>>({});
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [printing, setPrinting] = useState(false);
  const [draft, setDraft] = useState<{ name: string; category: string | null; price: number; stock: number }>({
    name: "",
    category: null,
    price: 0,
    stock: 0,
  });

  useEffect(() => saveLabelSettings(settings), [settings]);

  // The till's list: labels are for what is on sale.
  const products = useQuery({
    queryKey: ["products", "active"],
    queryFn: async () =>
      (await api.get<Paginated<Product>>("/products/?is_active=true&page_size=500")).data.results,
  });
  const storages = useQuery({
    queryKey: ["storages"],
    queryFn: async () => (await api.get<Paginated<Storage>>("/storages/")).data.results,
  });
  const printers = useQuery({
    queryKey: ["printers"],
    queryFn: () => platform.listPrinters(),
    enabled: platform.isElectron,
    staleTime: 60_000,
  });

  const list = products.data ?? [];
  const missing = list.filter((p) => !p.barcode);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) =>
      [p.name, p.category_name ?? "", p.barcode ?? ""].some((v) => v.toLowerCase().includes(q))
    );
  }, [list, search]);

  const copiesOf = (id: number) => copies[id] ?? 1;
  const printable = shown.filter((p) => p.barcode);
  const selectedProducts = list.filter((p) => p.barcode && selected.has(p.id));
  const selectedCount = selectedProducts.reduce((sum, p) => sum + copiesOf(p.id), 0);
  const previewProduct =
    list.find((p) => p.id === previewId && p.barcode) ?? selectedProducts[0] ?? list.find((p) => p.barcode);

  function contentFor(p: Product): LabelContent {
    const price = `${Number(p.price).toFixed(2)} ${t.labels.currency}`;
    return {
      storeName: settings.storeName.trim(),
      name: p.name,
      category: p.category_name,
      price: p.sold_by === "WEIGHT" ? `${price} / ${p.unit}` : price,
      barcode: p.barcode ?? "",
    };
  }

  function select(id: number, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const create = useMutation({
    mutationFn: async () => {
      const product = (
        await api.post<Product>("/products/", {
          name: draft.name.trim(),
          category: draft.category ? Number(draft.category) : null,
          price: draft.price,
          generate_barcode: true,
        })
      ).data;
      // Opening stock, as a restock would add it: without stock the till
      // scans the item but cannot sell it.
      let stockError: string | null = null;
      if (draft.stock > 0) {
        const storage = storages.data?.find((s) => s.is_default) ?? storages.data?.[0];
        try {
          if (!storage) throw new Error(t.labels.noStorage);
          await api.post("/stock-movements/", {
            product: product.id,
            storage: storage.id,
            change: draft.stock,
            reason: "PURCHASE",
            reference: "opening stock",
          });
        } catch (err) {
          stockError = serverMessage(err, (err as Error).message || t.common.unknownError);
        }
      }
      return { product, stock: draft.stock, stockError };
    },
    onSuccess: ({ product, stock, stockError }) => {
      qc.invalidateQueries({ queryKey: ["products"] });
      // Keep the category: items are usually added a shelf at a time.
      setDraft((d) => ({ ...d, name: "", price: 0, stock: 0 }));
      select(product.id, true);
      setPreviewId(product.id);
      // One label for each piece put into stock.
      if (stock > 0) setCopies((c) => ({ ...c, [product.id]: Math.min(MAX_COPIES, Math.ceil(stock)) }));
      notifications.show({
        title: t.products.saved,
        message: t.labels.created(product.name, product.barcode ?? ""),
        color: "green",
      });
      if (stockError) {
        notifications.show({ title: t.products.restockFailed, message: t.labels.stockFailed(stockError), color: "red" });
      }
    },
    onError: (err) =>
      notifications.show({ title: t.common.saveFailed, message: serverMessage(err, t.common.unknownError), color: "red" }),
  });

  const generate = useMutation({
    mutationFn: async (ids?: number[]) =>
      (
        await api.post<{ updated: number; products: Product[] }>(
          "/products/generate-barcodes/",
          ids ? { ids } : {}
        )
      ).data,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["products"] });
      if (data.products.length === 1) setPreviewId(data.products[0].id);
      notifications.show({ message: t.labels.generated(data.updated), color: "green" });
    },
    onError: (err) =>
      notifications.show({ title: t.common.failed, message: serverMessage(err, t.common.unknownError), color: "red" }),
  });

  async function print(pages: LabelPage[]) {
    const count = pages.reduce((sum, p) => sum + p.copies, 0);
    if (count === 0) return;
    setPrinting(true);
    const result = await platform.printLabels({
      html: buildLabelsHtml(pages, settings, lang),
      printer: settings.printer,
      widthMm: settings.widthMm,
      heightMm: settings.heightMm,
    });
    setPrinting(false);
    if (result.success) {
      notifications.show({ message: t.labels.sent(count), color: "green" });
    } else if (result.error !== "cancelled") {
      notifications.show({ title: t.labels.printFailed, message: result.error ?? t.common.unknownError, color: "red" });
    }
  }

  const zoom = Math.min(4, PREVIEW_WIDTH_PX / ((settings.widthMm + 4) * PX_PER_MM));
  const previewHtml = previewProduct
    ? buildLabelsHtml([{ content: contentFor(previewProduct), copies: 1 }], settings, lang, { preview: zoom })
    : null;
  const allShownSelected = printable.length > 0 && printable.every((p) => selected.has(p.id));
  const presetValue = LABEL_SIZES.some((s) => sizeKey(s) === sizeKey(settings)) ? sizeKey(settings) : CUSTOM_SIZE;

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t.nav.labels}</Title>
        <Group gap="sm">
          <Button
            variant="default"
            leftSection={<IconBarcode size={16} />}
            disabled={missing.length === 0}
            loading={generate.isPending}
            onClick={() => generate.mutate(undefined)}
          >
            {t.labels.generateMissing(missing.length)}
          </Button>
          <Button
            leftSection={<IconPrinter size={16} />}
            disabled={selectedCount === 0}
            loading={printing}
            onClick={() => print(selectedProducts.map((p) => ({ content: contentFor(p), copies: copiesOf(p.id) })))}
          >
            {t.labels.printSelected(selectedCount)}
          </Button>
        </Group>
      </Group>

      <Grid>
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Stack>
            <Card withBorder radius="md">
              <Stack gap="xs">
                <div>
                  <Text fw={600}>{t.labels.newItem}</Text>
                  <Text size="sm" c="dimmed">
                    {t.labels.newItemHint}
                  </Text>
                </div>
                <Group align="flex-end" grow preventGrowOverflow={false}>
                  <TextInput
                    label={t.common.name}
                    required
                    value={draft.name}
                    onChange={(e) => {
                      const name = e.currentTarget.value;
                      setDraft((d) => ({ ...d, name }));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && draft.name.trim() && draft.price > 0) create.mutate();
                    }}
                  />
                  <CategorySelect
                    value={draft.category}
                    onChange={(category) => setDraft((d) => ({ ...d, category }))}
                  />
                  <NumberInput
                    label={t.common.price}
                    min={0}
                    decimalScale={2}
                    value={draft.price}
                    onChange={(v) => setDraft((d) => ({ ...d, price: Number(v) || 0 }))}
                  />
                  <NumberInput
                    label={t.labels.stock}
                    min={0}
                    allowDecimal={false}
                    value={draft.stock}
                    onChange={(v) => setDraft((d) => ({ ...d, stock: Math.max(0, Number(v) || 0) }))}
                  />
                  <Button
                    leftSection={<IconPlus size={16} />}
                    disabled={!draft.name.trim() || draft.price <= 0}
                    loading={create.isPending}
                    onClick={() => create.mutate()}
                  >
                    {t.labels.create}
                  </Button>
                </Group>
              </Stack>
            </Card>

            <Card withBorder radius="md">
              <Stack>
                <TextInput
                  placeholder={t.labels.search}
                  leftSection={<IconSearch size={16} />}
                  value={search}
                  onChange={(e) => setSearch(e.currentTarget.value)}
                />
                <Table striped highlightOnHover verticalSpacing="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th w={40}>
                        <Checkbox
                          aria-label={t.labels.selectAll}
                          checked={allShownSelected}
                          indeterminate={!allShownSelected && printable.some((p) => selected.has(p.id))}
                          disabled={printable.length === 0}
                          onChange={(e) => {
                            const on = e.currentTarget.checked;
                            setSelected((prev) => {
                              const next = new Set(prev);
                              printable.forEach((p) => (on ? next.add(p.id) : next.delete(p.id)));
                              return next;
                            });
                          }}
                        />
                      </Table.Th>
                      <Table.Th>{t.common.item}</Table.Th>
                      <Table.Th>{t.common.price}</Table.Th>
                      <Table.Th>{t.products.barcode}</Table.Th>
                      <Table.Th w={110}>{t.labels.copies}</Table.Th>
                      <Table.Th w={56} />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {shown.map((p) => (
                      <Table.Tr
                        key={p.id}
                        onClick={() => p.barcode && setPreviewId(p.id)}
                        style={{ cursor: p.barcode ? "pointer" : undefined }}
                        bg={previewProduct?.id === p.id ? "var(--mantine-primary-color-light)" : undefined}
                      >
                        <Table.Td onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            aria-label={t.labels.selectItem(p.name)}
                            checked={selected.has(p.id)}
                            disabled={!p.barcode}
                            onChange={(e) => select(p.id, e.currentTarget.checked)}
                          />
                        </Table.Td>
                        <Table.Td>
                          <Group gap="sm" wrap="nowrap">
                            <ProductThumb src={productThumbUrl(p.image_url)} size={36} />
                            <div>
                              <Text size="sm" fw={500}>
                                {p.name}
                              </Text>
                              {p.category_name && (
                                <Text size="xs" c="dimmed">
                                  {p.category_name}
                                </Text>
                              )}
                            </div>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          {Number(p.price).toFixed(2)}
                          {p.sold_by === "WEIGHT" ? ` / ${p.unit}` : ""}
                        </Table.Td>
                        <Table.Td>
                          {p.barcode ? (
                            <Text size="sm" ff="monospace" dir="ltr" span>
                              {p.barcode}
                            </Text>
                          ) : (
                            <Group gap="xs" wrap="nowrap" onClick={(e) => e.stopPropagation()}>
                              <Badge color="gray" variant="light">
                                {t.labels.noCode}
                              </Badge>
                              <Button
                                size="compact-xs"
                                variant="light"
                                loading={generate.isPending && generate.variables?.[0] === p.id}
                                onClick={() => generate.mutate([p.id])}
                              >
                                {t.labels.generate}
                              </Button>
                            </Group>
                          )}
                        </Table.Td>
                        <Table.Td onClick={(e) => e.stopPropagation()}>
                          <NumberInput
                            size="xs"
                            min={1}
                            max={MAX_COPIES}
                            allowDecimal={false}
                            disabled={!p.barcode}
                            value={copiesOf(p.id)}
                            onChange={(v) =>
                              setCopies((c) => ({ ...c, [p.id]: Math.min(MAX_COPIES, Math.max(1, Number(v) || 1)) }))
                            }
                          />
                        </Table.Td>
                        <Table.Td onClick={(e) => e.stopPropagation()}>
                          <IconButton
                            label={t.labels.printItem(p.name)}
                            variant="subtle"
                            disabled={!p.barcode || printing}
                            onClick={() => print([{ content: contentFor(p), copies: copiesOf(p.id) }])}
                          >
                            <IconPrinter size={16} />
                          </IconButton>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Stack>
            </Card>
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Stack>
            <Card withBorder radius="md">
              <Stack gap="sm">
                <Text fw={600}>{t.labels.preview}</Text>
                {previewProduct && previewHtml ? (
                  <>
                    <iframe
                      title={t.labels.preview}
                      srcDoc={previewHtml}
                      sandbox=""
                      style={{
                        border: 0,
                        width: (settings.widthMm + 4) * zoom * PX_PER_MM,
                        height: (settings.heightMm + 4) * zoom * PX_PER_MM,
                        alignSelf: "center",
                      }}
                    />
                    {!barcodeFits(previewProduct.barcode ?? "", settings.widthMm) && (
                      <Alert color="orange">{t.labels.tooNarrow}</Alert>
                    )}
                  </>
                ) : (
                  <Text size="sm" c="dimmed">
                    {t.labels.previewEmpty}
                  </Text>
                )}
              </Stack>
            </Card>

            <Card withBorder radius="md">
              <Stack gap="sm">
                <div>
                  <Text fw={600}>{t.labels.printer}</Text>
                  <Text size="sm" c="dimmed">
                    {t.labels.printerHint}
                  </Text>
                </div>
                {platform.isElectron ? (
                  <Select
                    label={t.labels.printer}
                    data={[
                      { value: PRINT_DIALOG, label: t.labels.askEachTime },
                      ...(printers.data ?? []).map((p) => ({ value: p.name, label: p.displayName })),
                    ]}
                    value={settings.printer ?? PRINT_DIALOG}
                    onChange={(v) =>
                      setSettings((s) => ({ ...s, printer: !v || v === PRINT_DIALOG ? null : v }))
                    }
                    allowDeselect={false}
                    searchable
                  />
                ) : (
                  <Alert color="gray">{t.labels.desktopOnly}</Alert>
                )}
                <Select
                  label={t.labels.size}
                  data={[
                    ...LABEL_SIZES.map((s) => ({ value: sizeKey(s), label: `${s.widthMm} × ${s.heightMm} mm` })),
                    { value: CUSTOM_SIZE, label: t.labels.custom },
                  ]}
                  value={presetValue}
                  onChange={(v) => {
                    const preset = LABEL_SIZES.find((s) => sizeKey(s) === v);
                    if (preset) setSettings((s) => ({ ...s, ...preset }));
                  }}
                  allowDeselect={false}
                />
                <Group grow>
                  <NumberInput
                    label={t.labels.width}
                    min={20}
                    max={110}
                    value={settings.widthMm}
                    onChange={(v) => setSettings((s) => ({ ...s, widthMm: Math.max(20, Number(v) || 40) }))}
                  />
                  <NumberInput
                    label={t.labels.height}
                    min={15}
                    max={150}
                    value={settings.heightMm}
                    onChange={(v) => setSettings((s) => ({ ...s, heightMm: Math.max(15, Number(v) || 30) }))}
                  />
                </Group>
                <TextInput
                  label={t.labels.storeName}
                  value={settings.storeName}
                  onChange={(e) => {
                    const storeName = e.currentTarget.value;
                    setSettings((s) => ({ ...s, storeName }));
                  }}
                />
                <Text size="xs" c="dimmed">
                  {t.labels.driverSize}
                </Text>
              </Stack>
            </Card>
          </Stack>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
