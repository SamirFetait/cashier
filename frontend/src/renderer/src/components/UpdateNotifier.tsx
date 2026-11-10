import { Button, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconRefresh } from "@tabler/icons-react";
import { useEffect } from "react";

import { useI18n } from "../i18n";
import { platform } from "../platform";

const NOTIFICATION_ID = "app-update";

/**
 * A newer version finished downloading while the app was open: offer the
 * restart, but never force it. A restart mid-sale would lose the cart, so
 * dismissing it is "later", and the update then installs the next time the
 * app closes.
 */
export function UpdateNotifier() {
  const { t } = useI18n();

  useEffect(
    () =>
      platform.onUpdateStatus((status) => {
        if (status.state !== "downloaded") return;
        notifications.hide(NOTIFICATION_ID);
        notifications.show({
          id: NOTIFICATION_ID,
          color: "teal",
          autoClose: false,
          title: t.updates.readyTitle,
          message: (
            <Stack gap="xs" align="flex-start">
              <Text size="sm">{t.updates.readyBody(status.version ?? "")}</Text>
              <Button
                size="xs"
                leftSection={<IconRefresh size={14} />}
                onClick={() => void platform.installUpdate()}
              >
                {t.updates.restart}
              </Button>
            </Stack>
          ),
        });
      }),
    [t]
  );

  return null;
}
