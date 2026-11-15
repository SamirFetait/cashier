import { Button, Group, Modal, PasswordInput, Stack, Text } from "@mantine/core";
import { useEffect, useState } from "react";

import { useI18n } from "../i18n";

/** Asks a supervisor for their PIN when a discount is above the cashier's limit. */
export function PinPrompt({
  opened,
  onClose,
  onSubmit,
}: {
  opened: boolean;
  onClose: () => void;
  onSubmit: (pin: string) => void;
}) {
  const { t } = useI18n();
  const [pin, setPin] = useState("");

  useEffect(() => {
    if (opened) setPin("");
  }, [opened]);

  function submit() {
    if (!pin.trim()) return;
    onSubmit(pin);
    setPin("");
  }

  return (
    <Modal opened={opened} onClose={onClose} title={t.newOrder.pinTitle} centered>
      <Stack>
        <Text size="sm" c="dimmed">
          {t.newOrder.pinBody}
        </Text>
        <PasswordInput
          label={t.common.managerPin}
          value={pin}
          onChange={(e) => setPin(e.currentTarget.value)}
          data-autofocus
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button disabled={!pin.trim()} onClick={submit}>
            {t.newOrder.authorise}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
