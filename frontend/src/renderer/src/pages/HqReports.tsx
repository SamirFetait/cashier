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

const STATUS_COLOR: Record<string, string> = {
  SENT: "green",
  PENDING: "yellow",
  FAILED: "red",
};

export function HqReports() {
  const qc = useQueryClient();

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
        title: "Report sync run",
        message: `Sent ${data.sent}, failed ${data.failed}.`,
        color: data.failed ? "orange" : "green",
      });
    },
    onError: () =>
      notifications.show({ message: "Could not run report sync", color: "red" }),
  });

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>HQ Reports</Title>
        <Button
          leftSection={<IconCloudUpload size={16} />}
          loading={sendNow.isPending}
          onClick={() => sendNow.mutate()}
        >
          Generate & send today's report
        </Button>
      </Group>

      {branch.data && (
        <Card withBorder radius="md">
          <Group gap="xl">
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Branch</Text>
              <Text fw={600}>{branch.data.name} ({branch.data.code})</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Daily send time</Text>
              <Text fw={600}>{branch.data.report_time}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>HQ link</Text>
              <Badge color={branch.data.hq_configured ? "green" : "gray"}>
                {branch.data.hq_configured ? "Configured" : "Not configured"}
              </Badge>
            </div>
          </Group>
        </Card>
      )}

      {branch.data && !branch.data.hq_configured && (
        <Alert color="yellow">
          HQ_API_URL is not set on this branch — reports are generated but not sent. Set the HQ
          URL and key in the backend environment to enable delivery.
        </Alert>
      )}

      <Card withBorder radius="md">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Date</Table.Th>
              <Table.Th>Sales</Table.Th>
              <Table.Th>Orders</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Attempts</Table.Th>
              <Table.Th>Sent at</Table.Th>
              <Table.Th>Last error</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {reports.data?.map((r) => (
              <Table.Tr key={r.id}>
                <Table.Td>{r.date}</Table.Td>
                <Table.Td>{Number(r.sales_total).toFixed(2)}</Table.Td>
                <Table.Td>{r.order_count}</Table.Td>
                <Table.Td>
                  <Badge color={STATUS_COLOR[r.status] ?? "gray"}>{r.status}</Badge>
                </Table.Td>
                <Table.Td>{r.attempts}</Table.Td>
                <Table.Td>{r.sent_at ? new Date(r.sent_at).toLocaleString() : "—"}</Table.Td>
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
                    No reports yet. Click "Generate & send" to create today's.
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
