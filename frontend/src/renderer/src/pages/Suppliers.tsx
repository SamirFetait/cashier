import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Image,
  Loader,
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
import { IconBrandWhatsapp, IconEdit, IconPlus, IconQrcode } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../api/client";
import type { Paginated, Supplier, WhatsAppStatus } from "../api/types";
import { useAuth } from "../auth/AuthContext";

interface FormState {
  id?: number;
  name: string;
  phone_number: string;
  address: string;
  notes: string;
}

const empty: FormState = { name: "", phone_number: "", address: "", notes: "" };

export function Suppliers() {
  const { isSuperadmin } = useAuth();
  const qc = useQueryClient();
  const [opened, { open, close }] = useDisclosure(false);
  const [waOpen, wa] = useDisclosure(false);
  const [qrOpen, qr] = useDisclosure(false);
  const [form, setForm] = useState<FormState>(empty);
  const [target, setTarget] = useState<Supplier | null>(null);
  const [message, setMessage] = useState("");

  const suppliers = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () =>
      (await api.get<Paginated<Supplier>>("/suppliers/?page_size=500")).data.results,
  });

  const status = useQuery({
    queryKey: ["whatsapp-status"],
    queryFn: async () => (await api.get<WhatsAppStatus>("/whatsapp/status/")).data,
    refetchInterval: qrOpen ? 3000 : false,
    enabled: qrOpen || waOpen,
    retry: false,
  });

  const save = useMutation({
    mutationFn: async (f: FormState) => {
      const payload = {
        name: f.name,
        phone_number: f.phone_number,
        address: f.address,
        notes: f.notes,
      };
      if (f.id) return api.patch(`/suppliers/${f.id}/`, payload);
      return api.post("/suppliers/", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      close();
      notifications.show({ message: "Supplier saved", color: "green" });
    },
    onError: () => notifications.show({ message: "Save failed", color: "red" }),
  });

  const send = useMutation({
    mutationFn: async () =>
      api.post(`/suppliers/${target!.id}/whatsapp/`, { message }),
    onSuccess: () => {
      wa.close();
      setMessage("");
      notifications.show({
        title: "WhatsApp sent",
        message: `Message delivered to ${target?.name}`,
        color: "green",
      });
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail ?? "Send failed (is WhatsApp paired?)";
      notifications.show({ title: "WhatsApp error", message: detail, color: "red" });
    },
  });

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Suppliers</Title>
        <Group>
          {isSuperadmin && (
            <Button variant="default" leftSection={<IconQrcode size={16} />} onClick={qr.open}>
              WhatsApp setup
            </Button>
          )}
          {isSuperadmin && (
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={() => {
                setForm(empty);
                open();
              }}
            >
              Add supplier
            </Button>
          )}
        </Group>
      </Group>

      <Card withBorder radius="md">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Phone</Table.Th>
              <Table.Th>Address</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {suppliers.data?.map((s) => (
              <Table.Tr key={s.id}>
                <Table.Td>{s.name}</Table.Td>
                <Table.Td>{s.phone_number}</Table.Td>
                <Table.Td>{s.address || "—"}</Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    <Button
                      size="xs"
                      color="green"
                      leftSection={<IconBrandWhatsapp size={16} />}
                      onClick={() => {
                        setTarget(s);
                        setMessage("");
                        wa.open();
                      }}
                    >
                      WhatsApp
                    </Button>
                    {isSuperadmin && (
                      <ActionIcon
                        variant="subtle"
                        onClick={() => {
                          setForm({
                            id: s.id,
                            name: s.name,
                            phone_number: s.phone_number,
                            address: s.address,
                            notes: s.notes,
                          });
                          open();
                        }}
                      >
                        <IconEdit size={16} />
                      </ActionIcon>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      {/* Create / edit supplier */}
      <Modal opened={opened} onClose={close} title={form.id ? "Edit supplier" : "Add supplier"}>
        <Stack>
          <TextInput
            label="Name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
          />
          <TextInput
            label="Phone number"
            required
            value={form.phone_number}
            onChange={(e) => setForm({ ...form, phone_number: e.currentTarget.value })}
          />
          <TextInput
            label="Address"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.currentTarget.value })}
          />
          <Textarea
            label="Notes"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.currentTarget.value })}
          />
          <Button loading={save.isPending} onClick={() => save.mutate(form)}>
            Save
          </Button>
        </Stack>
      </Modal>

      {/* Send WhatsApp message */}
      <Modal opened={waOpen} onClose={wa.close} title={`WhatsApp ${target?.name ?? ""}`}>
        <Stack>
          <Text size="sm" c="dimmed">
            To: {target?.phone_number}
          </Text>
          <Textarea
            label="Message"
            minRows={4}
            autosize
            value={message}
            onChange={(e) => setMessage(e.currentTarget.value)}
            placeholder="Hello, we'd like to reorder…"
          />
          <Button
            color="green"
            leftSection={<IconBrandWhatsapp size={16} />}
            loading={send.isPending}
            disabled={!message.trim()}
            onClick={() => send.mutate()}
          >
            Send
          </Button>
        </Stack>
      </Modal>

      {/* WhatsApp pairing / status */}
      <Modal opened={qrOpen} onClose={qr.close} title="WhatsApp connection">
        <Stack align="center">
          {status.isLoading && <Loader />}
          {status.isError && (
            <Alert color="red">WhatsApp service is not reachable. Is it running?</Alert>
          )}
          {status.data?.connected && (
            <Badge color="green" size="lg">
              Connected
            </Badge>
          )}
          {status.data && !status.data.connected && status.data.qr && (
            <>
              <Text size="sm" c="dimmed" ta="center">
                Open WhatsApp on your phone → Linked devices → Link a device, then scan:
              </Text>
              <Image src={status.data.qr} w={260} h={260} />
            </>
          )}
          {status.data && !status.data.connected && !status.data.qr && (
            <Text c="dimmed">Waiting for the service to generate a QR…</Text>
          )}
        </Stack>
      </Modal>
    </Stack>
  );
}
