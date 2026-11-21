import {
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
import { IconBrandWhatsapp, IconEdit, IconLinkOff, IconPlus, IconQrcode } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import { useState } from "react";

import { api, fetchAll } from "../api/client";
import type { Supplier, WhatsAppStatus } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { DeleteButton } from "../components/DeleteButton";
import { IconButton } from "../components/IconButton";
import { ltr, useI18n } from "../i18n";
import { whatsappLink } from "../webOrders/api";

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
  const { t } = useI18n();
  const qc = useQueryClient();
  const [opened, { open, close }] = useDisclosure(false);
  const [qrOpen, qr] = useDisclosure(false);
  const [form, setForm] = useState<FormState>(empty);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  const suppliers = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => fetchAll<Supplier>("/suppliers/"),
  });

  // How the server sends order alerts. Through Meta's Cloud API there is no
  // phone to link, so nothing to poll for.
  const status = useQuery({
    queryKey: ["whatsapp-status"],
    queryFn: async () => (await api.get<WhatsAppStatus>("/whatsapp/status/")).data,
    refetchInterval: (query) => (qrOpen && query.state.data?.provider !== "cloud" ? 3000 : false),
    enabled: qrOpen,
    retry: false,
  });
  const statusFailure = (status.error as AxiosError<WhatsAppStatus> | null)?.response?.data;
  const cloud = status.data?.provider === "cloud";

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
      notifications.show({ message: t.suppliers.saved, color: "green" });
    },
    onError: () => notifications.show({ message: t.common.saveFailed, color: "red" }),
  });

  // Unlinking drops the server from the phone's Linked devices; the status
  // poll then shows the new QR for whichever phone links next.
  const unlink = useMutation({
    mutationFn: async () =>
      (await api.post<{ success: boolean; confirmed: boolean }>("/whatsapp/unlink/")).data,
    onSuccess: (result) => {
      setConfirmUnlink(false);
      notifications.show({
        message: result.confirmed ? t.suppliers.unlinked : t.suppliers.unlinkedHere,
        color: result.confirmed ? "green" : "yellow",
      });
      void qc.invalidateQueries({ queryKey: ["whatsapp-status"] });
    },
    onError: (err: any) => {
      notifications.show({
        title: t.suppliers.unlinkFailed,
        message: err?.response?.data?.detail ?? t.suppliers.unreachable,
        color: "red",
      });
    },
  });

  const closeQr = () => {
    qr.close();
    setConfirmUnlink(false);
  };

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t.nav.suppliers}</Title>
        <Group>
          {isSuperadmin && (
            <Button variant="default" leftSection={<IconQrcode size={16} />} onClick={qr.open}>
              {t.suppliers.setup}
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
              {t.suppliers.add}
            </Button>
          )}
        </Group>
      </Group>

      <Card withBorder radius="md">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t.common.name}</Table.Th>
              <Table.Th>{t.common.phone}</Table.Th>
              <Table.Th>{t.common.address}</Table.Th>
              <Table.Th>{t.common.actions}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {suppliers.data?.map((s) => (
              <Table.Tr key={s.id}>
                <Table.Td>{s.name}</Table.Td>
                <Table.Td>{ltr(s.phone_number)}</Table.Td>
                <Table.Td>{s.address || "—"}</Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    {/* Opens the chat in WhatsApp on this PC, from the shop's own number. */}
                    <Button
                      size="xs"
                      color="green"
                      component="a"
                      href={s.whatsapp ? whatsappLink(s.whatsapp) : undefined}
                      target="_blank"
                      title={t.suppliers.openChat}
                      leftSection={<IconBrandWhatsapp size={16} />}
                      disabled={!s.whatsapp}
                    >
                      {t.common.whatsapp}
                    </Button>
                    {isSuperadmin && (
                      <IconButton
                        label={t.suppliers.edit}
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
                      </IconButton>
                    )}
                    {isSuperadmin && (
                      <DeleteButton
                        label={t.suppliers.delete}
                        name={s.name}
                        url={`/suppliers/${s.id}/`}
                        queryKey={["suppliers"]}
                        inUse={t.suppliers.inUse}
                      />
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      {/* Create / edit supplier */}
      <Modal opened={opened} onClose={close} title={form.id ? t.suppliers.edit : t.suppliers.add}>
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

      {/* How order alerts go out: Meta's Cloud API, or the sidecar's pairing */}
      <Modal opened={qrOpen} onClose={closeQr} title={t.suppliers.connection}>
        <Stack align="center">
          {status.isLoading && <Loader />}
          {status.isError && (
            <Alert color="red">
              {statusFailure?.provider === "cloud"
                ? t.suppliers.cloudDown(statusFailure.error ?? "")
                : t.suppliers.unreachable}
            </Alert>
          )}
          {cloud && status.data?.connected && (
            <>
              <Badge color="green" size="lg">
                {t.suppliers.connected}
              </Badge>
              <Text size="sm" c="dimmed" ta="center">
                {t.suppliers.cloudSender(ltr(`+${status.data.number ?? ""}`))}
              </Text>
            </>
          )}
          {!cloud && status.data?.connected && (
            <>
              <Badge color="green" size="lg">
                {t.suppliers.connected}
              </Badge>
              {status.data.number && (
                <Text size="sm" c="dimmed">
                  {t.suppliers.linkedTo(ltr(`+${status.data.number}`))}
                </Text>
              )}
              {confirmUnlink ? (
                <>
                  <Text size="sm" ta="center">
                    {t.suppliers.unlinkConfirm}
                  </Text>
                  <Group>
                    <Button variant="default" disabled={unlink.isPending} onClick={() => setConfirmUnlink(false)}>
                      {t.common.cancel}
                    </Button>
                    <Button color="red" loading={unlink.isPending} onClick={() => unlink.mutate()}>
                      {t.suppliers.unlink}
                    </Button>
                  </Group>
                </>
              ) : (
                <Button
                  color="red"
                  variant="light"
                  leftSection={<IconLinkOff size={16} />}
                  onClick={() => setConfirmUnlink(true)}
                >
                  {t.suppliers.unlink}
                </Button>
              )}
            </>
          )}
          {!cloud && status.data && !status.data.connected && status.data.qr && (
            <>
              <Text size="sm" c="dimmed" ta="center">
                {t.suppliers.scanHint}
              </Text>
              <Image src={status.data.qr} alt={t.suppliers.qrAlt} w={260} h={260} />
            </>
          )}
          {!cloud && status.data && !status.data.connected && !status.data.qr && (
            <Text c="dimmed">{t.suppliers.waitingQr}</Text>
          )}
        </Stack>
      </Modal>
    </Stack>
  );
}
