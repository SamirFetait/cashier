import { Badge, Button, Group, Popover, Stack, Text } from "@mantine/core";
import { IconAlertTriangle, IconCloudOff, IconRefresh } from "@tabler/icons-react";
import { useState } from "react";

import { removeFromQueue } from "../pos/offlineQueue";
import { useOfflineSync } from "../pos/useOfflineSync";

/**
 * Connection and queue status.
 *
 * Deliberately visible in the header: staff need to know at a glance whether
 * sales are reaching the server, and a manager needs to see anything the
 * server refused on sync.
 */
export function OfflineIndicator() {
  const { online, pending, rejected, queue, syncing, sync } = useOfflineSync();
  const [opened, setOpened] = useState(false);

  if (online && pending === 0 && rejected === 0) return null;

  const rejectedSales = queue.filter((q) => q.rejected);

  return (
    <Popover opened={opened} onChange={setOpened} width={360} position="bottom-end">
      <Popover.Target>
        <Badge
          size="lg"
          variant="filled"
          color={rejected > 0 ? "red" : online ? "yellow" : "orange"}
          style={{ cursor: "pointer" }}
          leftSection={
            rejected > 0 ? <IconAlertTriangle size={12} /> : <IconCloudOff size={12} />
          }
          onClick={() => setOpened((o) => !o)}
        >
          {rejected > 0
            ? `${rejected} failed`
            : online
              ? `Syncing ${pending}`
              : `Offline · ${pending} queued`}
        </Badge>
      </Popover.Target>

      <Popover.Dropdown>
        <Stack gap="xs">
          <Text fw={600}>
            {online ? "Connected" : "No connection to the server"}
          </Text>
          <Text size="sm" c="dimmed">
            {online
              ? "Queued sales are being sent."
              : "Sales are being saved on this terminal and will sync automatically when the connection returns."}
          </Text>

          {pending > 0 && (
            <Group justify="space-between">
              <Text size="sm">{pending} sale(s) waiting</Text>
              <Button
                size="xs"
                variant="light"
                leftSection={<IconRefresh size={14} />}
                loading={syncing}
                onClick={() => void sync()}
              >
                Sync now
              </Button>
            </Group>
          )}

          {rejectedSales.length > 0 && (
            <Stack gap={4}>
              <Text size="sm" fw={600} c="red">
                Rejected by the server — needs attention
              </Text>
              {rejectedSales.map((entry) => (
                <Group key={entry.client_uuid} justify="space-between" wrap="nowrap">
                  <Text size="xs" style={{ flex: 1 }}>
                    {new Date(entry.queuedAt).toLocaleString()} — {entry.lastError}
                  </Text>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="red"
                    onClick={() => removeFromQueue(entry.client_uuid)}
                  >
                    Discard
                  </Button>
                </Group>
              ))}
              <Text size="xs" c="dimmed">
                These were rung up offline but the server refused them — usually
                because stock ran out. Re-ring them if the goods were handed over.
              </Text>
            </Stack>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
