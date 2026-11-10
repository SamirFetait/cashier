import {
  Box,
  Button,
  Card,
  Center,
  Divider,
  Group,
  Image,
  PasswordInput,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useState } from "react";

import logo from "../assets/brand/logo.webp";
import { useAuth } from "../auth/AuthContext";
import { BRAND } from "../brand/brand";
import { BRAND_GRADIENT } from "../brand/theme";
import { WhatsAppContact } from "../brand/WhatsAppContact";
import { LanguageToggle } from "../components/LanguageToggle";
import { ThemeToggle } from "../components/ThemeToggle";
import { useI18n } from "../i18n";

// The emblem's honeycomb as a faint tile over a badge-teal backdrop.
const HONEYCOMB =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='52' height='90'%3E" +
  "%3Cpath d='M26 0 52 15v30L26 60 0 45V15zM26 60v30' fill='none' stroke='%23fff' " +
  "stroke-opacity='.14' stroke-width='1.5'/%3E%3C/svg%3E\")";

const BACKDROP =
  `${HONEYCOMB}, linear-gradient(160deg, ` +
  "light-dark(var(--mantine-color-teal-4), var(--mantine-color-teal-9)), " +
  "light-dark(var(--mantine-color-teal-8), #04211e))";

export function Login() {
  const { login } = useAuth();
  const { t } = useI18n();
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
      setError(t.login.invalid);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box mih="100vh" pos="relative" style={{ background: BACKDROP }}>
      <Group pos="absolute" top={0} p="md" gap="xs" style={{ insetInlineEnd: 0 }}>
        <LanguageToggle />
        <ThemeToggle />
      </Group>
      <Center mih="100vh" p="md">
        <Card shadow="xl" padding="xl" radius="lg" w={400}>
          <Card.Section h={5} style={{ backgroundImage: BRAND_GRADIENT }} />
          <Image src={logo} alt={`${BRAND.name} · ${BRAND.nameAr}`} w={250} mx="auto" mt="md" />
          <form onSubmit={submit}>
            <Stack mt="lg">
              <Text c="dimmed" size="sm" ta="center">
                {t.login.subtitle}
              </Text>
              <TextInput
                label={t.login.username}
                value={username}
                onChange={(e) => setUsername(e.currentTarget.value)}
                required
                autoFocus
              />
              <PasswordInput
                label={t.login.password}
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                required
              />
              {error && (
                <Text c="red" size="sm">
                  {error}
                </Text>
              )}
              <Button type="submit" loading={loading} fullWidth size="md">
                {t.login.submit}
              </Button>
            </Stack>
          </form>
          <Divider my="lg" />
          <Group justify="center">
            <WhatsAppContact />
          </Group>
        </Card>
      </Center>
    </Box>
  );
}
