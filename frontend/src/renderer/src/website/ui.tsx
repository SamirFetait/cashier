/** Pieces every website page shares, after the orders admin's look. */
import { Box, Button, Center, Group, Modal, Stack, Text, Title } from "@mantine/core";
import { useCallback, useState, type ReactNode } from "react";

import { useI18n } from "../i18n";

/** A page's title and what it is for, with its main action opposite. */
export function PageHead({ title, intro, children }: { title: string; intro?: string; children?: ReactNode }) {
  return (
    <Group justify="space-between" align="flex-start" wrap="nowrap" gap="lg">
      <Stack gap={4}>
        <Title order={2}>{title}</Title>
        {intro && (
          <Text c="dimmed" size="sm" maw={720}>
            {intro}
          </Text>
        )}
      </Stack>
      {children && (
        <Group gap="sm" wrap="nowrap" style={{ flexShrink: 0 }}>
          {children}
        </Group>
      )}
    </Group>
  );
}

/** A honey cell: the website's hexagon, holding an icon. */
export function HexIcon({ children, size = 72 }: { children: ReactNode; size?: number }) {
  return (
    <Box
      w={size}
      h={size * 0.9}
      bg="var(--mantine-color-gold-light)"
      c="var(--mantine-color-gold-light-color)"
      style={{
        clipPath: "polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </Box>
  );
}

/** Nothing to list yet. */
export function EmptyState({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <Center py={48}>
      <Stack align="center" gap="sm">
        <HexIcon>{icon}</HexIcon>
        <Text fw={600} ta="center">
          {title}
        </Text>
      </Stack>
    </Center>
  );
}

/**
 * Asks before something is deleted. `ask` resolves true once confirmed;
 * render `dialog` once in the component that asks.
 */
export function useConfirm() {
  const { t } = useI18n();
  const [pending, setPending] = useState<{
    question: string;
    action: string;
    resolve: (ok: boolean) => void;
  } | null>(null);

  const ask = useCallback(
    (question: string, action: string) =>
      new Promise<boolean>((resolve) => setPending({ question, action, resolve })),
    []
  );

  const answer = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  const dialog = (
    <Modal opened={pending !== null} onClose={() => answer(false)} title={pending?.question} centered size="sm">
      <Text size="sm" c="dimmed">
        {t.website.cannotUndo}
      </Text>
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={() => answer(false)}>
          {t.common.cancel}
        </Button>
        <Button color="red" onClick={() => answer(true)} data-autofocus>
          {pending?.action}
        </Button>
      </Group>
    </Modal>
  );

  return { ask, dialog };
}
