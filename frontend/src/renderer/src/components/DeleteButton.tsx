import { Button, Group, Modal, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconTrash } from "@tabler/icons-react";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";

import { api } from "../api/client";
import { useI18n } from "../i18n";
import { IconButton } from "./IconButton";

/**
 * The trash icon on a list row: it asks first, then deletes through the API.
 * The server refuses (409) a record that sales, stock, purchase or shift
 * records still point at; `inUse` then says what to do instead.
 */
export function DeleteButton({
  label,
  name,
  url,
  queryKey,
  inUse,
}: {
  /** e.g. "Delete customer": the tooltip, and the confirmation's title. */
  label: string;
  /** The record as people know it, e.g. the customer's name. */
  name: string;
  /** The record's API URL, e.g. `/customers/12/`. */
  url: string;
  /** The list to refresh once it is gone. */
  queryKey: QueryKey;
  /** What to say when the record is still in use. */
  inUse?: string;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [opened, { open, close }] = useDisclosure(false);

  const remove = useMutation({
    mutationFn: () => api.delete(url),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey });
      notifications.show({ message: t.common.deleted(name), color: "green" });
    },
    onError: (err) => {
      const response = (err as any)?.response;
      notifications.show({
        color: "red",
        message:
          response?.status === 409
            ? (inUse ?? t.common.inUse(name))
            : (response?.data?.detail ?? t.common.deleteFailed),
      });
    },
    onSettled: close,
  });

  return (
    <>
      <IconButton label={label} color="red" variant="subtle" onClick={open}>
        <IconTrash size={16} />
      </IconButton>
      {/* Mounted only while asking, so a long list holds no hidden dialogs. */}
      {opened && (
        <Modal opened onClose={close} title={label} size="sm">
          <Text size="sm">{t.common.confirmDelete(name)}</Text>
          <Group justify="flex-end" mt="lg">
            <Button variant="default" onClick={close} disabled={remove.isPending}>
              {t.common.cancel}
            </Button>
            <Button color="red" loading={remove.isPending} onClick={() => remove.mutate()}>
              {t.common.delete}
            </Button>
          </Group>
        </Modal>
      )}
    </>
  );
}
