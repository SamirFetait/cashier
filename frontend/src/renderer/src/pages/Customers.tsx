import {
  ActionIcon,
  Button,
  Card,
  Group,
  Modal,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconEdit, IconHistory, IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../api/client";
import type { Customer, Order, Paginated } from "../api/types";
import { ltr, useI18n } from "../i18n";

interface FormState {
  id?: number;
  name: string;
  phone_number: string;
  address: string;
  notes: string;
}

const empty: FormState = { name: "", phone_number: "", address: "", notes: "" };

export function Customers() {
  const qc = useQueryClient();
  const { t, formatDate } = useI18n();
  const [opened, { open, close }] = useDisclosure(false);
  const [historyOpen, history] = useDisclosure(false);
  const [form, setForm] = useState<FormState>(empty);
  const [historyCustomer, setHistoryCustomer] = useState<Customer | null>(null);

  const customers = useQuery({
    queryKey: ["customers"],
    queryFn: async () =>
      (await api.get<Paginated<Customer>>("/customers/?page_size=500")).data.results,
  });

  const orderHistory = useQuery({
    queryKey: ["customer-orders", historyCustomer?.id],
    queryFn: async () =>
      (await api.get<Paginated<Order>>(`/orders/?customer=${historyCustomer!.id}`)).data
        .results,
    enabled: !!historyCustomer,
  });

  const save = useMutation({
    mutationFn: async (f: FormState) => {
      const payload = {
        name: f.name,
        phone_number: f.phone_number,
        address: f.address,
        notes: f.notes,
      };
      if (f.id) return api.patch(`/customers/${f.id}/`, payload);
      return api.post("/customers/", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      close();
      notifications.show({ message: t.customers.saved, color: "green" });
    },
    onError: () => notifications.show({ message: t.common.saveFailed, color: "red" }),
  });

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t.nav.customers}</Title>
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={() => {
            setForm(empty);
            open();
          }}
        >
          {t.customers.add}
        </Button>
      </Group>

      <Card withBorder radius="md">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t.common.name}</Table.Th>
              <Table.Th>{t.common.phone}</Table.Th>
              <Table.Th>{t.common.address}</Table.Th>
              <Table.Th>{t.common.orders}</Table.Th>
              <Table.Th>{t.customers.totalSpent}</Table.Th>
              <Table.Th>{t.common.actions}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {customers.data?.map((c) => (
              <Table.Tr key={c.id}>
                <Table.Td>{c.name}</Table.Td>
                <Table.Td>{ltr(c.phone_number)}</Table.Td>
                <Table.Td>{c.address || "—"}</Table.Td>
                <Table.Td>{c.order_count}</Table.Td>
                <Table.Td>{Number(c.total_spent).toFixed(2)}</Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    <ActionIcon
                      variant="subtle"
                      onClick={() => {
                        setForm({
                          id: c.id,
                          name: c.name,
                          phone_number: c.phone_number,
                          address: c.address,
                          notes: c.notes,
                        });
                        open();
                      }}
                    >
                      <IconEdit size={16} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="wood"
                      onClick={() => {
                        setHistoryCustomer(c);
                        history.open();
                      }}
                    >
                      <IconHistory size={16} />
                    </ActionIcon>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      <Modal opened={opened} onClose={close} title={form.id ? t.customers.edit : t.customers.add}>
        <Stack>
          <TextInput
            label={t.common.name}
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
          />
          <TextInput
            label={t.common.phoneNumber}
            required
            dir="ltr"
            value={form.phone_number}
            onChange={(e) => setForm({ ...form, phone_number: e.currentTarget.value })}
          />
          <TextInput
            label={t.common.address}
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.currentTarget.value })}
          />
          <Textarea
            label={t.common.notes}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.currentTarget.value })}
          />
          <Button loading={save.isPending} onClick={() => save.mutate(form)}>
            {t.common.save}
          </Button>
        </Stack>
      </Modal>

      <Modal
        opened={historyOpen}
        onClose={history.close}
        title={t.customers.history(historyCustomer?.name ?? "")}
        size="lg"
      >
        {orderHistory.data && orderHistory.data.length > 0 ? (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>#</Table.Th>
                <Table.Th>{t.common.date}</Table.Th>
                <Table.Th>{t.common.items}</Table.Th>
                <Table.Th>{t.common.total}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {orderHistory.data.map((o) => (
                <Table.Tr key={o.id}>
                  <Table.Td>{o.id}</Table.Td>
                  <Table.Td>{formatDate(o.created_at)}</Table.Td>
                  <Table.Td>{o.items.length}</Table.Td>
                  <Table.Td>{Number(o.total).toFixed(2)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        ) : (
          <Text c="dimmed">{t.customers.noOrders}</Text>
        )}
      </Modal>
    </Stack>
  );
}
