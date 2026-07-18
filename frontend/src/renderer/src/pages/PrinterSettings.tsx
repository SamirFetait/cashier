import {
  Alert,
  Button,
  Card,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconPrinter } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { platform } from "../platform";
import type { ReceiptLine } from "../receipt/escposReceipt";

interface PrinterConfig {
  transport: "network" | "device" | "none";
  host?: string;
  port?: number;
  path?: string;
  width?: number;
}

const TEST_PAGE: ReceiptLine[] = [
  { left: "PRINTER TEST", align: "center", bold: true, double: true },
  { rule: true },
  { left: "Left column", right: "9.99" },
  { left: "A much longer product name here", right: "123.45" },
  { rule: true },
  { left: "TOTAL", right: "133.44", bold: true },
  { feed: 1 },
  { left: "If this is legible and the", align: "center" },
  { left: "columns line up, the width", align: "center" },
  { left: "setting is correct.", align: "center" },
];

export function PrinterSettings() {
  const [config, setConfig] = useState<PrinterConfig>({ transport: "none" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    platform.getPrinterConfig().then((c) => setConfig(c as PrinterConfig));
  }, []);

  async function save() {
    await platform.setPrinterConfig(config);
    notifications.show({
      title: "Printer settings saved",
      message: "This terminal will use them for the next receipt.",
      color: "green",
    });
  }

  async function testPrint() {
    setBusy(true);
    await platform.setPrinterConfig(config);
    const result = await platform.printEscPos(TEST_PAGE);
    setBusy(false);
    notifications.show({
      title: result.success ? "Test sent" : "Test failed",
      message: result.success
        ? "Check the printer."
        : (result.error ?? "Unknown error"),
      color: result.success ? "green" : "red",
    });
  }

  async function testDrawer() {
    setBusy(true);
    await platform.setPrinterConfig(config);
    const result = await platform.openCashDrawer();
    setBusy(false);
    notifications.show({
      title: result.success ? "Drawer signal sent" : "Drawer failed",
      message: result.error ?? "The drawer should have opened.",
      color: result.success ? "green" : "red",
    });
  }

  if (!platform.isElectron) {
    return (
      <Stack>
        <Title order={2}>Receipt printer</Title>
        <Alert color="orange">
          Thermal printing is only available in the desktop app. In a browser
          tab receipts fall back to the print dialog.
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack>
      <Title order={2}>Receipt printer</Title>
      <Card withBorder radius="md" maw={560}>
        <Stack>
          <Select
            label="Connection"
            description="Most counter-top thermal printers listen on the network at port 9100"
            data={[
              { value: "none", label: "None — use the print dialog" },
              { value: "network", label: "Network (TCP/IP)" },
              { value: "device", label: "Device / shared printer" },
            ]}
            value={config.transport}
            onChange={(v) =>
              setConfig((c) => ({ ...c, transport: (v as PrinterConfig["transport"]) || "none" }))
            }
            allowDeselect={false}
          />

          {config.transport === "network" && (
            <Group grow>
              <TextInput
                label="Printer IP"
                placeholder="192.168.1.50"
                value={config.host ?? ""}
                onChange={(e) => setConfig((c) => ({ ...c, host: e.currentTarget.value }))}
              />
              <NumberInput
                label="Port"
                value={config.port ?? 9100}
                onChange={(v) => setConfig((c) => ({ ...c, port: Number(v) || 9100 }))}
              />
            </Group>
          )}

          {config.transport === "device" && (
            <TextInput
              label="Device path"
              description="e.g. \\\\SERVER\\Receipt on Windows, or /dev/usb/lp0 on Linux"
              value={config.path ?? ""}
              onChange={(e) => setConfig((c) => ({ ...c, path: e.currentTarget.value }))}
            />
          )}

          {config.transport !== "none" && (
            <Select
              label="Paper width"
              data={[
                { value: "32", label: "58mm (32 characters)" },
                { value: "42", label: "80mm (42 characters)" },
              ]}
              value={String(config.width ?? 42)}
              onChange={(v) => setConfig((c) => ({ ...c, width: Number(v) || 42 }))}
              allowDeselect={false}
            />
          )}

          <Text size="sm" c="dimmed">
            When no thermal printer is set, receipts still print through the
            normal dialog — a printer fault never blocks a sale.
          </Text>

          <Group>
            <Button onClick={save}>Save</Button>
            <Button
              variant="light"
              leftSection={<IconPrinter size={16} />}
              onClick={testPrint}
              loading={busy}
              disabled={config.transport === "none"}
            >
              Test print
            </Button>
            <Button
              variant="default"
              onClick={testDrawer}
              loading={busy}
              disabled={config.transport === "none"}
            >
              Test drawer
            </Button>
          </Group>
        </Stack>
      </Card>
    </Stack>
  );
}
