import {
  ActionIcon,
  Badge,
  Button,
  Card,
  FileButton,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconEdit, IconPackageImport, IconPlus, IconTrash, IconUpload } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { api } from "../api/client";
import type { Category, Paginated, Product, Storage } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ProductThumb, productThumbUrl } from "../components/ProductThumb";
import { useI18n } from "../i18n";

interface FormState {
  id?: number;
  name: string;
  category: string | null;
  price: number;
  cost: number;
  unit: string;
  barcode: string;
  is_active: boolean;
}

const empty: FormState = {
  name: "",
  category: null,
  price: 0,
  cost: 0,
  unit: "pcs",
  barcode: "",
  is_active: true,
};

/** Same limit the server enforces; checked here to fail before uploading. */
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

interface PhotoState {
  /** A photo picked in this form, uploaded on save. */
  file: File | null;
  /** What the form shows: the saved photo, or a local preview of the pick. */
  preview: string | null;
  /** Delete the saved photo on save. */
  remove: boolean;
}

const noPhoto: PhotoState = { file: null, preview: null, remove: false };

/** The product itself saved; only its photo did not. */
class PhotoUploadError extends Error {
  constructor(
    readonly product: Product,
    readonly reason: unknown
  ) {
    super("Photo upload failed");
  }
}

export function Products() {
  const { isSuperadmin } = useAuth();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [opened, { open, close }] = useDisclosure(false);
  const [restockOpen, restock] = useDisclosure(false);
  const [form, setForm] = useState<FormState>(empty);
  const [photo, setPhoto] = useState<PhotoState>(noPhoto);
  const resetFilePicker = useRef<() => void>(null);
  const [restockTarget, setRestockTarget] = useState<Product | null>(null);
  const [restockQty, setRestockQty] = useState<number>(0);

  // A picked photo is previewed from an object URL; free each one once it
  // has been replaced or the form is gone.
  useEffect(() => {
    const preview = photo.preview;
    return () => {
      if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
    };
  }, [photo.preview]);

  const products = useQuery({
    queryKey: ["products"],
    queryFn: async () =>
      (await api.get<Paginated<Product>>("/products/?page_size=500")).data.results,
  });
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: async () =>
      (await api.get<Paginated<Category>>("/categories/?page_size=500")).data.results,
  });
  const storages = useQuery({
    queryKey: ["storages"],
    queryFn: async () =>
      (await api.get<Paginated<Storage>>("/storages/")).data.results,
    enabled: isSuperadmin,
  });

  const save = useMutation({
    mutationFn: async ({ f, photo }: { f: FormState; photo: PhotoState }) => {
      const payload = {
        name: f.name,
        category: f.category ? Number(f.category) : null,
        price: f.price,
        cost: f.cost,
        unit: f.unit,
        barcode: f.barcode || null,
        is_active: f.is_active,
      };
      const product = (
        f.id
          ? await api.patch<Product>(`/products/${f.id}/`, payload)
          : await api.post<Product>("/products/", payload)
      ).data;
      // The photo is its own request, once there is a product to attach it to.
      try {
        if (photo.file) {
          const body = new FormData();
          body.append("image", photo.file);
          await api.post(`/products/${product.id}/image/`, body);
        } else if (photo.remove) {
          await api.delete(`/products/${product.id}/image/`);
        }
      } catch (err) {
        throw new PhotoUploadError(product, err);
      }
      return product;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      close();
      notifications.show({ message: t.products.saved, color: "green" });
    },
    onError: (err) => {
      if (err instanceof PhotoUploadError) {
        // Stay on the saved product, so saving again updates it instead of
        // creating a second copy.
        qc.invalidateQueries({ queryKey: ["products"] });
        setForm((current) => ({ ...current, id: err.product.id }));
        const data = (err.reason as any)?.response?.data;
        notifications.show({
          message: t.products.photoFailed(data?.image?.[0] ?? data?.detail ?? t.common.unknownError),
          color: "red",
        });
        return;
      }
      notifications.show({ message: t.common.saveFailed, color: "red" });
    },
  });

  const remove = useMutation({
    mutationFn: async (id: number) => api.delete(`/products/${id}/`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      notifications.show({ message: t.products.deleted, color: "green" });
    },
    onError: () =>
      notifications.show({ message: t.products.deleteFailed, color: "red" }),
  });

  const doRestock = useMutation({
    mutationFn: async () => {
      const storage =
        storages.data?.find((s) => s.is_default) ?? storages.data?.[0];
      if (!storage) throw new Error("no storage");
      return api.post("/stock-movements/", {
        product: restockTarget!.id,
        storage: storage.id,
        change: restockQty,
        reason: "PURCHASE",
        reference: "manual restock",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      restock.close();
      notifications.show({ message: t.products.stockUpdated, color: "green" });
    },
    onError: () => notifications.show({ message: t.products.restockFailed, color: "red" }),
  });

  function openCreate() {
    setForm(empty);
    setPhoto(noPhoto);
    open();
  }
  function openEdit(p: Product) {
    setForm({
      id: p.id,
      name: p.name,
      category: p.category ? String(p.category) : null,
      price: Number(p.price),
      cost: Number(p.cost),
      unit: p.unit,
      barcode: p.barcode ?? "",
      is_active: p.is_active,
    });
    setPhoto({ file: null, preview: productThumbUrl(p.image_url), remove: false });
    open();
  }

  function pickPhoto(file: File | null) {
    resetFilePicker.current?.(); // so picking the same file again still registers
    if (!file) return;
    if (file.size > MAX_PHOTO_BYTES) {
      notifications.show({ message: t.products.photoTooLarge, color: "red" });
      return;
    }
    setPhoto({ file, preview: URL.createObjectURL(file), remove: false });
  }

  function removePhoto() {
    setPhoto({ file: null, preview: null, remove: Boolean(form.id) });
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t.nav.products}</Title>
        {isSuperadmin && (
          <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
            {t.products.add}
          </Button>
        )}
      </Group>

      <Card withBorder radius="md">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={56} />
              <Table.Th>{t.common.name}</Table.Th>
              <Table.Th>{t.products.category}</Table.Th>
              <Table.Th>{t.common.price}</Table.Th>
              <Table.Th>{t.products.inStorage}</Table.Th>
              <Table.Th>{t.common.status}</Table.Th>
              {isSuperadmin && <Table.Th>{t.common.actions}</Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {products.data?.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td>
                  <ProductThumb src={productThumbUrl(p.image_url)} />
                </Table.Td>
                <Table.Td>{p.name}</Table.Td>
                <Table.Td>{p.category_name ?? "—"}</Table.Td>
                <Table.Td>{Number(p.price).toFixed(2)}</Table.Td>
                <Table.Td>{p.quantity_in_storage}</Table.Td>
                <Table.Td>
                  <Badge color={p.is_active ? "green" : "gray"}>
                    {p.is_active ? t.common.active : t.common.inactive}
                  </Badge>
                </Table.Td>
                {isSuperadmin && (
                  <Table.Td>
                    <Group gap="xs">
                      <ActionIcon variant="subtle" onClick={() => openEdit(p)}>
                        <IconEdit size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color="teal"
                        onClick={() => {
                          setRestockTarget(p);
                          setRestockQty(0);
                          restock.open();
                        }}
                      >
                        <IconPackageImport size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        onClick={() => remove.mutate(p.id)}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {!isSuperadmin && (
          <Text c="dimmed" size="sm" mt="sm">
            {t.products.readOnly}
          </Text>
        )}
      </Card>

      <Modal opened={opened} onClose={close} title={form.id ? t.products.edit : t.products.add}>
        <Stack>
          <Group wrap="nowrap">
            <ProductThumb src={photo.preview} size={88} />
            <Stack gap={6}>
              <Text size="sm" fw={500}>
                {t.products.photo}
              </Text>
              <Group gap="xs">
                <FileButton
                  resetRef={resetFilePicker}
                  onChange={pickPhoto}
                  accept="image/png,image/jpeg,image/webp"
                >
                  {(props) => (
                    <Button {...props} size="xs" variant="light" leftSection={<IconUpload size={14} />}>
                      {photo.preview ? t.products.changePhoto : t.products.choosePhoto}
                    </Button>
                  )}
                </FileButton>
                {photo.preview && (
                  <Button size="xs" variant="subtle" color="red" onClick={removePhoto}>
                    {t.products.removePhoto}
                  </Button>
                )}
              </Group>
              <Text size="xs" c="dimmed">
                {t.products.photoHint}
              </Text>
            </Stack>
          </Group>
          <TextInput
            label={t.common.name}
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
          />
          <Select
            label={t.products.category}
            clearable
            data={(categories.data ?? []).map((c) => ({
              value: String(c.id),
              label: c.name,
            }))}
            value={form.category}
            onChange={(v) => setForm({ ...form, category: v })}
          />
          <Group grow>
            <NumberInput
              label={t.common.price}
              min={0}
              decimalScale={2}
              value={form.price}
              onChange={(v) => setForm({ ...form, price: Number(v) || 0 })}
            />
            <NumberInput
              label={t.common.cost}
              min={0}
              decimalScale={2}
              value={form.cost}
              onChange={(v) => setForm({ ...form, cost: Number(v) || 0 })}
            />
          </Group>
          <Group grow>
            <TextInput
              label={t.products.unit}
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.currentTarget.value })}
            />
            <TextInput
              label={t.products.barcode}
              dir="ltr"
              value={form.barcode}
              onChange={(e) => setForm({ ...form, barcode: e.currentTarget.value })}
            />
          </Group>
          <Switch
            label={t.common.active}
            checked={form.is_active}
            onChange={(e) => setForm({ ...form, is_active: e.currentTarget.checked })}
          />
          <Button loading={save.isPending} onClick={() => save.mutate({ f: form, photo })}>
            {t.common.save}
          </Button>
        </Stack>
      </Modal>

      <Modal
        opened={restockOpen}
        onClose={restock.close}
        title={t.products.restockTitle(restockTarget?.name ?? "")}
      >
        <Stack>
          <Text size="sm" c="dimmed">
            {t.products.restockHint}
          </Text>
          <NumberInput
            label={t.products.restockQty}
            min={1}
            value={restockQty}
            onChange={(v) => setRestockQty(Number(v) || 0)}
          />
          <Button
            loading={doRestock.isPending}
            disabled={restockQty < 1}
            onClick={() => doRestock.mutate()}
          >
            {t.products.addStock}
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}
