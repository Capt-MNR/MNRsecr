function firstConfiguredDomain(value: string | undefined): string | null {
  const domain = value?.split(",")[0]?.trim();
  if (!domain) return null;
  return domain.includes("://") ? domain : `https://${domain}`;
}

export function getOAuthPublicOrigin(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const configured = env.AUTH_PUBLIC_ORIGIN?.trim()
    || firstConfiguredDomain(env.REPLIT_DOMAINS)
    || firstConfiguredDomain(env.REPLIT_DEV_DOMAIN);
  if (!configured) return null;
  try {
    const parsed = new URL(configured);
    const isLocalHttp = parsed.protocol === "http:"
      && ["localhost", "127.0.0.1"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !isLocalHttp) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}
