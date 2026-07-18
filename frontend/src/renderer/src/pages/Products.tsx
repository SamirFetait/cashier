import {
  ActionIcon,
  Badge,
  Button,
  Card,
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
import { IconEdit, IconPackageImport, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../api/client";
import type { Category, Paginated, Product, Storage } from "../api/types";
import { useAuth } from "../auth/AuthContext";

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

export function Products() {
  const { isSuperadmin } = useAuth();
  const qc = useQueryClient();
  const [opened, { open, close }] = useDisclosure(false);
  const [restockOpen, restock] = useDisclosure(false);
  const [form, setForm] = useState<FormState>(empty);
  const [restockTarget, setRestockTarget] = useState<Product | null>(null);
  const [restockQty, setRestockQty] = useState<number>(0);

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
    mutationFn: async (f: FormState) => {
      const payload = {
        name: f.name,
        category: f.category ? Number(f.category) : null,
        price: f.price,
        cost: f.cost,
        unit: f.unit,
        barcode: f.barcode || null,
        is_active: f.is_active,
      };
      if (f.id) return api.patch(`/products/${f.id}/`, payload);
      return api.post("/products/", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      close();
      notifications.show({ message: "Product saved", color: "green" });
    },
    onError: () => notifications.show({ message: "Save failed", color: "red" }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => api.delete(`/products/${id}/`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      notifications.show({ message: "Product deleted", color: "green" });
    },
    onError: () =>
      notifications.show({ message: "Cannot delete (in use?)", color: "red" }),
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
      notifications.show({ message: "Stock updated", color: "green" });
    },
    onError: () => notifications.show({ message: "Restock failed", color: "red" }),
  });

  function openCreate() {
    setForm(empty);
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
    open();
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Products & Storage</Title>
        {isSuperadmin && (
          <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
            Add product
          </Button>
        )}
      </Group>

      <Card withBorder radius="md">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Category</Table.Th>
              <Table.Th>Price</Table.Th>
              <Table.Th>In Storage</Table.Th>
              <Table.Th>Status</Table.Th>
              {isSuperadmin && <Table.Th>Actions</Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {products.data?.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td>{p.name}</Table.Td>
                <Table.Td>{p.category_name ?? "—"}</Table.Td>
                <Table.Td>{Number(p.price).toFixed(2)}</Table.Td>
                <Table.Td>{p.quantity_in_storage}</Table.Td>
                <Table.Td>
                  <Badge color={p.is_active ? "green" : "gray"}>
                    {p.is_active ? "Active" : "Inactive"}
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
            You have read-only access to products.
          </Text>
        )}
      </Card>

      <Modal opened={opened} onClose={close} title={form.id ? "Edit product" : "Add product"}>
        <Stack>
          <TextInput
            label="Name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
          />
          <Select
            label="Category"
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
              label="Price"
              min={0}
              decimalScale={2}
              value={form.price}
              onChange={(v) => setForm({ ...form, price: Number(v) || 0 })}
            />
            <NumberInput
              label="Cost"
              min={0}
              decimalScale={2}
              value={form.cost}
              onChange={(v) => setForm({ ...form, cost: Number(v) || 0 })}
            />
          </Group>
          <Group grow>
            <TextInput
              label="Unit"
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.currentTarget.value })}
            />
            <TextInput
              label="Barcode"
              value={form.barcode}
              onChange={(e) => setForm({ ...form, barcode: e.currentTarget.value })}
            />
          </Group>
          <Switch
            label="Active"
            checked={form.is_active}
            onChange={(e) => setForm({ ...form, is_active: e.currentTarget.checked })}
          />
          <Button loading={save.isPending} onClick={() => save.mutate(form)}>
            Save
          </Button>
        </Stack>
      </Modal>

      <Modal opened={restockOpen} onClose={restock.close} title={`Restock ${restockTarget?.name ?? ""}`}>
        <Stack>
          <Text size="sm" c="dimmed">
            Adds stock to the default storage location.
          </Text>
          <NumberInput
            label="Quantity to add"
            min={1}
            value={restockQty}
            onChange={(v) => setRestockQty(Number(v) || 0)}
          />
          <Button
            loading={doRestock.isPending}
            disabled={restockQty < 1}
            onClick={() => doRestock.mutate()}
          >
            Add stock
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}
