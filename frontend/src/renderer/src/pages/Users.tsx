import {
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

import { api, fetchAll } from "../api/client";
import type { Role, User } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { DeleteButton } from "../components/DeleteButton";
import { IconButton } from "../components/IconButton";
import { ltr, useI18n } from "../i18n";

interface FormState {
  id?: number;
  username: string;
  role: Role;
  phone_number: string;
  password: string;
  is_active: boolean;
  /** The manager PIN to set; blank keeps the current one. */
  override_pin: string;
  has_override_pin: boolean;
}

const empty: FormState = {
  username: "",
  role: "CASHIER",
  phone_number: "",
  password: "",
  is_active: true,
  override_pin: "",
  has_override_pin: false,
};

export function Users() {
  const qc = useQueryClient();
  const { t } = useI18n();
  const { user: me } = useAuth();
  const [opened, { open, close }] = useDisclosure(false);
  const [form, setForm] = useState<FormState>(empty);

  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => fetchAll<User>("/users/"),
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
      if (f.override_pin) payload.override_pin = f.override_pin;
      if (f.id) return api.patch(`/users/${f.id}/`, payload);
      return api.post("/users/", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      close();
      notifications.show({ message: t.users.saved, color: "green" });
    },
    onError: (err: any) =>
      notifications.show({
        title: t.common.saveFailed,
        message: err?.response?.data?.override_pin?.[0] ?? undefined,
        color: "red",
      }),
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
                  <Group gap={6}>
                    <Badge color={u.role === "SUPERADMIN" ? "gold.4" : "teal"} autoContrast>
                      {t.roles[u.role]}
                    </Badge>
                    {/* Cashiers' large discounts, voids and refunds need a manager's PIN. */}
                    {u.is_superadmin && !u.has_override_pin && (
                      <Badge color="red" variant="light">
                        {t.users.noPin}
                      </Badge>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td>{u.phone_number ? ltr(u.phone_number) : "—"}</Table.Td>
                <Table.Td>
                  <Badge color={u.is_active ? "green" : "gray"}>
                    {u.is_active ? t.common.active : t.common.inactive}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    <IconButton
                      label={t.users.edit}
                      variant="subtle"
                      onClick={() => {
                        setForm({
                          id: u.id,
                          username: u.username,
                          role: u.role,
                          phone_number: u.phone_number,
                          password: "",
                          is_active: u.is_active,
                          override_pin: "",
                          has_override_pin: Boolean(u.has_override_pin),
                        });
                        open();
                      }}
                    >
                      <IconEdit size={16} />
                    </IconButton>
                    {/* Not your own account: the server refuses that anyway. */}
                    {u.id !== me?.id && (
                      <DeleteButton
                        label={t.users.delete}
                        name={u.username}
                        url={`/users/${u.id}/`}
                        queryKey={["users"]}
                        inUse={t.users.inUse}
                      />
                    )}
                  </Group>
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
          {form.role === "SUPERADMIN" && (
            <PasswordInput
              label={t.users.pin}
              description={form.has_override_pin ? t.users.pinKeep : t.users.pinHint}
              inputMode="numeric"
              dir="ltr"
              maxLength={12}
              value={form.override_pin}
              onChange={(e) => setForm({ ...form, override_pin: e.currentTarget.value.replace(/\D/g, "") })}
              error={form.override_pin && form.override_pin.length < 4 ? t.users.pinShort : undefined}
            />
          )}
          <Switch
            label={t.common.active}
            checked={form.is_active}
            onChange={(e) => setForm({ ...form, is_active: e.currentTarget.checked })}
          />
          <Button
            loading={save.isPending}
            disabled={Boolean(form.override_pin) && form.override_pin.length < 4}
            onClick={() => save.mutate(form)}
          >
            {t.common.save}
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}
