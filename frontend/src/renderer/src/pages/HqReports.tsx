import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCloudUpload } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../api/client";
import type { BranchInfo, DailyReport, Paginated } from "../api/types";
import { useI18n } from "../i18n";

const STATUS_COLOR: Record<string, string> = {
  SENT: "green",
  PENDING: "yellow",
  FAILED: "red",
};

export function HqReports() {
  const qc = useQueryClient();
  const { t, formatDateTime } = useI18n();

  const branch = useQuery({
    queryKey: ["branch"],
    queryFn: async () => (await api.get<BranchInfo>("/branch/")).data,
  });
  const reports = useQuery({
    queryKey: ["daily-reports"],
    queryFn: async () =>
      (await api.get<Paginated<DailyReport>>("/daily-reports/")).data.results,
  });

  const sendNow = useMutation({
    mutationFn: async () => (await api.post("/daily-reports/send-now/")).data,
    onSuccess: (data: { sent: number; failed: number }) => {
      qc.invalidateQueries({ queryKey: ["daily-reports"] });
      notifications.show({
        title: t.hq.syncRun,
        message: t.hq.syncResult(data.sent, data.failed),
        color: data.failed ? "orange" : "green",
      });
    },
    onError: () =>
      notifications.show({ message: t.hq.syncFailed, color: "red" }),
  });

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t.nav.hqReports}</Title>
        <Button
          leftSection={<IconCloudUpload size={16} />}
          loading={sendNow.isPending}
          onClick={() => sendNow.mutate()}
        >
          {t.hq.generate}
        </Button>
      </Group>

      {branch.data && (
        <Card withBorder radius="md">
          <Group gap="xl">
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{t.hq.branch}</Text>
              <Text fw={600}>{branch.data.name} ({branch.data.code})</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{t.hq.sendTime}</Text>
              <Text fw={600}>{branch.data.report_time}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{t.hq.link}</Text>
              <Badge color={branch.data.hq_configured ? "green" : "gray"}>
                {branch.data.hq_configured ? t.hq.configured : t.hq.notConfigured}
              </Badge>
            </div>
          </Group>
        </Card>
      )}

      {branch.data && !branch.data.hq_configured && (
        <Alert color="yellow">{t.hq.notConfiguredAlert}</Alert>
      )}

      <Card withBorder radius="md">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t.common.date}</Table.Th>
              <Table.Th>{t.common.sales}</Table.Th>
              <Table.Th>{t.common.orders}</Table.Th>
              <Table.Th>{t.common.status}</Table.Th>
              <Table.Th>{t.hq.attempts}</Table.Th>
              <Table.Th>{t.hq.sentAt}</Table.Th>
              <Table.Th>{t.hq.lastError}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {reports.data?.map((r) => (
              <Table.Tr key={r.id}>
                <Table.Td>{r.date}</Table.Td>
                <Table.Td>{Number(r.sales_total).toFixed(2)}</Table.Td>
                <Table.Td>{r.order_count}</Table.Td>
                <Table.Td>
                  <Badge color={STATUS_COLOR[r.status] ?? "gray"}>{t.hqStatus[r.status]}</Badge>
                </Table.Td>
                <Table.Td>{r.attempts}</Table.Td>
                <Table.Td>{r.sent_at ? formatDateTime(r.sent_at) : "—"}</Table.Td>
                <Table.Td>
                  <Text c="red" size="xs" lineClamp={1}>
                    {r.last_error || "—"}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ))}
            {reports.data?.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={7}>
                  <Text c="dimmed" ta="center" py="md">
                    {t.hq.none}
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  );
}
