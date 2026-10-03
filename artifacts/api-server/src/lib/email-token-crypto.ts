import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function encryptionKey(rawKey: string | undefined): Buffer {
  if (!rawKey) throw new Error("EMAIL_TOKEN_ENCRYPTION_KEY_MISSING");
  const key = Buffer.from(rawKey, "base64");
  if (key.length !== 32) throw new Error("EMAIL_TOKEN_ENCRYPTION_KEY_INVALID");
  return key;
}

export function isEmailTokenEncryptionKeyConfigured(rawKey = process.env.EMAIL_TOKEN_ENCRYPTION_KEY): boolean {
  try {
    encryptionKey(rawKey);
    return true;
  } catch {
    return false;
  }
}

export function encryptEmailToken(
  plaintext: string,
  rawKey = process.env.EMAIL_TOKEN_ENCRYPTION_KEY,
): string {
  if (!plaintext) throw new Error("EMAIL_TOKEN_EMPTY");
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(rawKey), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    "v1",
    cipher.getAuthTag().toString("base64url"),
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptEmailToken(
  value: string,
  rawKey = process.env.EMAIL_TOKEN_ENCRYPTION_KEY,
): string {
  const [version, authTag, iv, ciphertext, ...extra] = value.split(".");
  if (version !== "v1" || !authTag || !iv || !ciphertext || extra.length) {
    throw new Error("EMAIL_TOKEN_CIPHERTEXT_INVALID");
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    encryptionKey(rawKey),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(authTag, "base64url"));
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("EMAIL_TOKEN_DECRYPT_FAILED");
  }
}