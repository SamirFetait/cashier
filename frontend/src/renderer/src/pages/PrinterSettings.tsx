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

import { ltr, useI18n } from "../i18n";
import { platform } from "../platform";
import type { ReceiptLine } from "../receipt/escposReceipt";

interface PrinterConfig {
  transport: "network" | "device" | "none";
  host?: string;
  port?: number;
  path?: string;
  width?: number;
}

// Printed in the printer's own Latin font, so it stays English.
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
  const { t, lang } = useI18n();
  const [config, setConfig] = useState<PrinterConfig>({ transport: "none" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    platform.getPrinterConfig().then((c) => setConfig(c as PrinterConfig));
  }, []);

  async function save() {
    await platform.setPrinterConfig(config);
    notifications.show({
      title: t.printer.saved,
      message: t.printer.savedMessage,
      color: "green",
    });
  }

  async function testPrint() {
    setBusy(true);
    await platform.setPrinterConfig(config);
    const result = await platform.printEscPos(TEST_PAGE);
    setBusy(false);
    notifications.show({
      title: result.success ? t.printer.testSent : t.printer.testFailed,
      message: result.success
        ? t.printer.checkPrinter
        : (result.error ?? t.common.unknownError),
      color: result.success ? "green" : "red",
    });
  }

  async function testDrawer() {
    setBusy(true);
    await platform.setPrinterConfig(config);
    const result = await platform.openCashDrawer();
    setBusy(false);
    notifications.show({
      title: result.success ? t.printer.drawerSent : t.printer.drawerFailed,
      message: result.error ?? t.printer.drawerShouldOpen,
      color: result.success ? "green" : "red",
    });
  }

  if (!platform.isElectron) {
    return (
      <Stack>
        <Title order={2}>{t.printer.title}</Title>
        <Alert color="orange">{t.printer.browserOnly}</Alert>
      </Stack>
    );
  }

  return (
    <Stack>
      <Title order={2}>{t.printer.title}</Title>
      <Card withBorder radius="md" maw={560}>
        <Stack>
          <Select
            label={t.printer.connection}
            description={t.printer.connectionHint}
            data={[
              { value: "none", label: t.printer.none },
              { value: "network", label: t.printer.network },
              { value: "device", label: t.printer.device },
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
                label={t.printer.ip}
                placeholder="192.168.1.50"
                dir="ltr"
                value={config.host ?? ""}
                onChange={(e) => setConfig((c) => ({ ...c, host: e.currentTarget.value }))}
              />
              <NumberInput
                label={t.printer.port}
                value={config.port ?? 9100}
                onChange={(v) => setConfig((c) => ({ ...c, port: Number(v) || 9100 }))}
              />
            </Group>
          )}

          {config.transport === "device" && (
            <TextInput
              label={t.printer.devicePath}
              description={t.printer.devicePathHint(ltr("\\\\SERVER\\Receipt"), ltr("/dev/usb/lp0"))}
              dir="ltr"
              value={config.path ?? ""}
              onChange={(e) => setConfig((c) => ({ ...c, path: e.currentTarget.value }))}
            />
          )}

          {config.transport !== "none" && (
            <Select
              label={t.printer.paperWidth}
              data={[
                { value: "32", label: t.printer.width58 },
                { value: "42", label: t.printer.width80 },
              ]}
              value={String(config.width ?? 42)}
              onChange={(v) => setConfig((c) => ({ ...c, width: Number(v) || 42 }))}
              allowDeselect={false}
            />
          )}

          <Text size="sm" c="dimmed">
            {t.printer.fallbackNote}
          </Text>

          {lang === "ar" && config.transport !== "none" && (
            <Alert color="gold">{t.printer.englishOnly}</Alert>
          )}

          <Group>
            <Button onClick={save}>{t.common.save}</Button>
            <Button
              variant="light"
              leftSection={<IconPrinter size={16} />}
              onClick={testPrint}
              loading={busy}
              disabled={config.transport === "none"}
            >
              {t.printer.testPrint}
            </Button>
            <Button
              variant="default"
              onClick={testDrawer}
              loading={busy}
              disabled={config.transport === "none"}
            >
              {t.printer.testDrawer}
            </Button>
          </Group>
        </Stack>
      </Card>
    </Stack>
  );
}
