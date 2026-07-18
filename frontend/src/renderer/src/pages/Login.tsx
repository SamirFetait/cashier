import {
  Box,
  Button,
  Card,
  Center,
  Group,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useState } from "react";

import { useAuth } from "../auth/AuthContext";
import { ThemeToggle } from "../components/ThemeToggle";

export function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username, password);
    } catch {
      setError("Invalid username or password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box
      h="100vh"
      bg="light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-8))"
    >
      <Group justify="flex-end" p="md">
        <ThemeToggle />
      </Group>
      <Center h="calc(100vh - 76px)">
        <Card shadow="md" padding="xl" radius="md" w={380}>
          <form onSubmit={submit}>
            <Stack>
              <Title order={2} ta="center">
                Cashier POS
              </Title>
              <Text c="dimmed" size="sm" ta="center">
                Sign in to continue
              </Text>
              <TextInput
                label="Username"
                value={username}
                onChange={(e) => setUsername(e.currentTarget.value)}
                required
                autoFocus
              />
              <PasswordInput
                label="Password"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                required
              />
              {error && (
                <Text c="red" size="sm">
                  {error}
                </Text>
              )}
              <Button type="submit" loading={loading} fullWidth>
                Sign in
              </Button>
            </Stack>
          </form>
        </Card>
      </Center>
    </Box>
  );
}
