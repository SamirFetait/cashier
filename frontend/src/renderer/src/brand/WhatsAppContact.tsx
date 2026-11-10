import { Anchor, Group, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconBrandWhatsapp } from "@tabler/icons-react";

import { ltr, useI18n } from "../i18n";
import { BRAND } from "./brand";

/**
 * The store's WhatsApp number as a click-to-chat link.
 *
 * target="_blank" is load-bearing: the main process hands new windows to the
 * system browser (and on to WhatsApp), so the POS window never navigates away.
 */
export function WhatsAppContact() {
  const { t } = useI18n();
  return (
    <Anchor
      href={BRAND.whatsapp.link}
      target="_blank"
      rel="noreferrer"
      underline="never"
      c="inherit"
    >
      <Group gap="xs" wrap="nowrap">
        <ThemeIcon color="green" variant="light" radius="xl" size="lg">
          <IconBrandWhatsapp size={20} />
        </ThemeIcon>
        <Stack gap={0}>
          <Text size="xs" c="dimmed" lh={1.2}>
            {t.common.whatsapp}
          </Text>
          <Text size="sm" fw={600} lh={1.3}>
            {ltr(BRAND.whatsapp.display)}
          </Text>
        </Stack>
      </Group>
    </Anchor>
  );
}
