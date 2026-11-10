import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Table,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconEdit, IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../api/client";
import type { Paginated, Role, User } from "../api/types";
import { ltr, useI18n } from "../i18n";

interface FormState {
  id?: number;
  username: string;
  role: Role;
  phone_number: string;
  password: string;
  is_active: boolean;
}

const empty: FormState = {
  username: "",
  role: "CASHIER",
  phone_number: "",
  password: "",
  is_active: true,
};

export function Users() {
  const qc = useQueryClient();
  const { t } = useI18n();
  const [opened, { open, close }] = useDisclosure(false);
  const [form, setForm] = useState<FormState>(empty);

  const users = useQuery({
    queryKey: ["users"],
    queryFn: async () =>
      (await api.get<Paginated<User>>("/users/?page_size=500")).data.results,
  });

  const save = useMutation({
    mutationFn: async (f: FormState) => {
      const payload: Record<string, unknown> = {
        username: f.username,
        role: f.role,
        phone_number: f.phone_number,
        is_active: f.is_active,
      };
      if (f.password) payload.password = f.password;
      if (f.id) return api.patch(`/users/${f.id}/`, payload);
      return api.post("/users/", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      close();
      notifications.show({ message: t.users.saved, color: "green" });
    },
    onError: () => notifications.show({ message: t.common.saveFailed, color: "red" }),
  });

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t.nav.users}</Title>
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={() => {
            setForm(empty);
            open();
          }}
        >
          {t.users.add}
        </Button>
      </Group>

      <Card withBorder radius="md">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t.users.username}</Table.Th>
              <Table.Th>{t.users.role}</Table.Th>
              <Table.Th>{t.common.phone}</Table.Th>
              <Table.Th>{t.common.status}</Table.Th>
              <Table.Th>{t.common.actions}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {users.data?.map((u) => (
              <Table.Tr key={u.id}>
                <Table.Td>{u.username}</Table.Td>
                <Table.Td>
                  <Badge color={u.role === "SUPERADMIN" ? "gold.4" : "teal"} autoContrast>
                    {t.roles[u.role]}
                  </Badge>
                </Table.Td>
                <Table.Td>{u.phone_number ? ltr(u.phone_number) : "—"}</Table.Td>
                <Table.Td>
                  <Badge color={u.is_active ? "green" : "gray"}>
                    {u.is_active ? t.common.active : t.common.inactive}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <ActionIcon
                    variant="subtle"
                    onClick={() => {
                      setForm({
                        id: u.id,
                        username: u.username,
                        role: u.role,
                        phone_number: u.phone_number,
                        password: "",
                        is_active: u.is_active,
                      });
                      open();
                    }}
                  >
                    <IconEdit size={16} />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      <Modal opened={opened} onClose={close} title={form.id ? t.users.edit : t.users.add}>
        <Stack>
          <TextInput
            label={t.users.username}
            required
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.currentTarget.value })}
          />
          <Select
            label={t.users.role}
            data={[
              { value: "CASHIER", label: t.roles.CASHIER },
              { value: "SUPERADMIN", label: t.roles.SUPERADMIN },
            ]}
            value={form.role}
            onChange={(v) => setForm({ ...form, role: (v as Role) || "CASHIER" })}
          />
          <TextInput
            label={t.common.phoneNumber}
            dir="ltr"
            value={form.phone_number}
            onChange={(e) => setForm({ ...form, phone_number: e.currentTarget.value })}
          />
          <PasswordInput
            label={form.id ? t.users.newPassword : t.users.password}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.currentTarget.value })}
          />
          <Switch
            label={t.common.active}
            checked={form.is_active}
            onChange={(e) => setForm({ ...form, is_active: e.currentTarget.checked })}
          />
          <Button loading={save.isPending} onClick={() => save.mutate(form)}>
            {t.common.save}
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}
