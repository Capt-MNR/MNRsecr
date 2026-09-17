import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

export type LocalInputAttachment = {
  inputId: string;
  kind: 'voice' | 'receipt';
  mimeType: string;
  localUri: string;
  createdAt: string;
};

const STORAGE_PREFIX = '@personal-secretary-mobile/input-asset/';
const ASSET_DIRECTORY = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}secretary-input-assets/`
  : null;

function storageKey(inputId: string) {
  return `${STORAGE_PREFIX}${inputId}`;
}

function safeInputId(inputId: string) {
  return inputId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function extensionFor(kind: LocalInputAttachment['kind'], mimeType: string) {
  const normalized = mimeType.toLowerCase();
  if (kind === 'receipt') {
    if (normalized.includes('png')) return 'png';
    if (normalized.includes('webp')) return 'webp';
    return 'jpg';
  }
  if (normalized.includes('webm')) return 'webm';
  if (normalized.includes('wav')) return 'wav';
  return 'm4a';
}

export async function saveLocalInputAsset(input: {
  inputId: string;
  kind: LocalInputAttachment['kind'];
  mimeType: string;
  sourceUri: string;
}): Promise<LocalInputAttachment | null> {
  if (!ASSET_DIRECTORY || !input.inputId || !input.sourceUri) return null;

  const existing = await getLocalInputAttachment(input.inputId);
  if (existing) {
    const existingInfo = await FileSystem.getInfoAsync(existing.localUri);
    if (existingInfo.exists) return existing;
  }

  await FileSystem.makeDirectoryAsync(ASSET_DIRECTORY, { intermediates: true });
  const targetUri = `${ASSET_DIRECTORY}${safeInputId(input.inputId)}.${extensionFor(input.kind, input.mimeType)}`;
  const targetInfo = await FileSystem.getInfoAsync(targetUri);
  if (!targetInfo.exists) {
    await FileSystem.copyAsync({ from: input.sourceUri, to: targetUri });
  }

  const attachment: LocalInputAttachment = {
    inputId: input.inputId,
    kind: input.kind,
    mimeType: input.mimeType,
    localUri: targetUri,
    createdAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(storageKey(input.inputId), JSON.stringify(attachment));
  return attachment;
}

export async function getLocalInputAttachment(inputId: string): Promise<LocalInputAttachment | null> {
  if (!inputId) return null;
  const stored = await AsyncStorage.getItem(storageKey(inputId));
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as Partial<LocalInputAttachment>;
    if (
      parsed.inputId !== inputId
      || (parsed.kind !== 'voice' && parsed.kind !== 'receipt')
      || typeof parsed.mimeType !== 'string'
      || typeof parsed.localUri !== 'string'
      || typeof parsed.createdAt !== 'string'
    ) {
      return null;
    }
    const info = await FileSystem.getInfoAsync(parsed.localUri);
    return info.exists ? parsed as LocalInputAttachment : null;
  } catch {
    return null;
  }
}

export async function hydrateLocalInputAttachments<
  T extends { inputId?: string | null; inputAttachment?: LocalInputAttachment | null },
>(messages: T[]): Promise<T[]> {
  const hydrated = await Promise.all(messages.map(async (message) => {
    if (!message.inputId || message.inputAttachment) return message;
    const inputAttachment = await getLocalInputAttachment(message.inputId);
    return inputAttachment ? { ...message, inputAttachment } : message;
  }));
  return hydrated;
}