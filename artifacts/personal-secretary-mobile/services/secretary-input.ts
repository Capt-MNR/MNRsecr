import { useAudioRecorder, RecordingPresets, requestRecordingPermissionsAsync } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useState } from 'react';
import {
  processSecretaryInputAsset,
  type InputAssetProcessResponse,
} from '@workspace/api-client-react';

export type SecretaryInputState = 'idle' | 'recording' | 'processing';

export type SecretaryInputResult = InputAssetProcessResponse;

export function receiptNeedsReview(result: SecretaryInputResult | null | undefined): boolean {
  if (!result || result.kind !== 'receipt' || !result.receipt) return false;
  return result.receipt.amountMinor === null
    || result.receipt.amountMinor <= 0
    || !result.receipt.currency?.trim();
}

export function receiptDraft(result: SecretaryInputResult): string {
  if (result.kind !== 'receipt' || !result.receipt) return result.text;
  const { amountMinor, currency, merchant, description, occurredAt } = result.receipt;
  const amount = amountMinor !== null ? (amountMinor / 100).toFixed(2).replace(/\.00$/, '') : '';
  const parts = [
    amount && currency ? `سجل مصروف ${amount} ${currency}` : '',
    description ?? result.text,
    merchant ? `لـ ${merchant}` : '',
    occurredAt ? `بتاريخ ${occurredAt}` : '',
  ].filter(Boolean);
  return parts.join(' ').trim();
}

async function processFile(
  kind: 'voice' | 'receipt',
  uri: string,
  mimeType: string,
  base64?: string,
): Promise<SecretaryInputResult> {
  const encoded = base64 ?? await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return processSecretaryInputAsset({ kind, mimeType, base64: encoded });
}

export function useSecretaryInputCapture(
  onResult: (result: SecretaryInputResult) => void,
  onError: (message: string) => void,
) {
  const recorder = useAudioRecorder(RecordingPresets.LOW_QUALITY);
  const [state, setState] = useState<SecretaryInputState>('idle');

  const toggleVoice = useCallback(async () => {
    if (state === 'processing') return;
    if (state === 'recording') {
      try {
        await recorder.stop();
        const uri = recorder.uri;
        if (!uri) throw new Error('RECORDING_URI_MISSING');
        setState('processing');
        const result = await processFile('voice', uri, uri.endsWith('.webm') ? 'audio/webm' : 'audio/m4a');
        onResult(result);
      } catch {
        onError('تعذر تحويل التسجيل الصوتي. جرّب مرة أخرى.');
      } finally {
        setState('idle');
      }
      return;
    }
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        onError('اسمح للسكرتير باستخدام الميكروفون أولًا.');
        return;
      }
      await recorder.prepareToRecordAsync();
      recorder.record({ forDuration: 90 });
      setState('recording');
    } catch {
      onError('تعذر بدء التسجيل الصوتي.');
      setState('idle');
    }
  }, [onError, onResult, recorder, state]);

  const pickReceipt = useCallback(async (source: 'camera' | 'library') => {
    if (state !== 'idle') return;
    try {
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          quality: 0.65,
          base64: true,
        })
        : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          quality: 0.65,
          base64: true,
        });
      if (result.canceled || !result.assets[0]?.uri) return;
      setState('processing');
      const asset = result.assets[0];
      const processed = await processFile(
        'receipt',
        asset.uri,
        asset.mimeType ?? 'image/jpeg',
        asset.base64 ?? undefined,
      );
      onResult(processed);
    } catch {
      onError('تعذر قراءة صورة الفاتورة. جرّب صورة أوضح.');
    } finally {
      setState('idle');
    }
  }, [onError, onResult, state]);

  return {
    state,
    toggleVoice,
    pickReceipt,
  };
}