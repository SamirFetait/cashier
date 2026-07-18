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
      notifications.show({ message: "User saved", color: "green" });
    },
    onError: () => notifications.show({ message: "Save failed", color: "red" }),
  });

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Users</Title>
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={() => {
            setForm(empty);
            open();
          }}
        >
          Add user
        </Button>
      </Group>

      <Card withBorder radius="md">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Username</Table.Th>
              <Table.Th>Role</Table.Th>
              <Table.Th>Phone</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {users.data?.map((u) => (
              <Table.Tr key={u.id}>
                <Table.Td>{u.username}</Table.Td>
                <Table.Td>
                  <Badge color={u.role === "SUPERADMIN" ? "grape" : "blue"}>
                    {u.role}
                  </Badge>
                </Table.Td>
                <Table.Td>{u.phone_number || "—"}</Table.Td>
                <Table.Td>
                  <Badge color={u.is_active ? "green" : "gray"}>
                    {u.is_active ? "Active" : "Inactive"}
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

      <Modal opened={opened} onClose={close} title={form.id ? "Edit user" : "Add user"}>
        <Stack>
          <TextInput
            label="Username"
            required
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.currentTarget.value })}
          />
          <Select
            label="Role"
            data={[
              { value: "CASHIER", label: "Cashier" },
              { value: "SUPERADMIN", label: "Super Admin" },
            ]}
            value={form.role}
            onChange={(v) => setForm({ ...form, role: (v as Role) || "CASHIER" })}
          />
          <TextInput
            label="Phone number"
            value={form.phone_number}
            onChange={(e) => setForm({ ...form, phone_number: e.currentTarget.value })}
          />
          <PasswordInput
            label={form.id ? "New password (leave blank to keep)" : "Password"}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.currentTarget.value })}
          />
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
    </Stack>
  );
}
