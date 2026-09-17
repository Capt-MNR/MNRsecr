import { useAudioRecorder, RecordingPresets, requestRecordingPermissionsAsync } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useState } from 'react';
import {
  processSecretaryInputAsset,
  type InputAssetProcessResponse,
} from '@workspace/api-client-react';
import { saveLocalInputAsset, type LocalInputAttachment } from './local-input-assets';

export type SecretaryInputState = 'idle' | 'recording' | 'processing';

export type SecretaryInputResult = InputAssetProcessResponse & {
  localAttachment?: LocalInputAttachment;
};
type RetryableInputAsset = {
  kind: 'voice' | 'receipt';
  uri: string;
  mimeType: string;
  base64?: string;
};

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
  const [retryableAsset, setRetryableAsset] = useState<RetryableInputAsset | null>(null);

  const processCapturedAsset = useCallback(async (asset: RetryableInputAsset, errorMessage: string) => {
    setState('processing');
    try {
      const result = await processFile(asset.kind, asset.uri, asset.mimeType, asset.base64);
      let localAttachment: LocalInputAttachment | undefined;
      try {
        localAttachment = (await saveLocalInputAsset({
          inputId: result.inputId,
          kind: asset.kind,
          mimeType: asset.mimeType,
          sourceUri: asset.uri,
        })) ?? undefined;
      } catch {
        localAttachment = undefined;
      }
      setRetryableAsset(localAttachment ? null : asset);
      onResult(localAttachment ? { ...result, localAttachment } : result);
      if (!localAttachment) {
        onError('تمت معالجة الإدخال، لكن تعذر حفظ الأصل على الجهاز. يمكنك استخدام النص الآن أو إعادة المحاولة لاحقًا.');
      }
    } catch {
      setRetryableAsset(asset);
      onError(errorMessage);
    } finally {
      setState('idle');
    }
  }, [onError, onResult]);

  const toggleVoice = useCallback(async () => {
    if (state === 'processing') return;
    if (state === 'recording') {
      try {
        await recorder.stop();
        const uri = recorder.uri;
        if (!uri) throw new Error('RECORDING_URI_MISSING');
        await processCapturedAsset(
          { kind: 'voice', uri, mimeType: uri.endsWith('.webm') ? 'audio/webm' : 'audio/m4a' },
          'تعذر تحويل التسجيل الصوتي. جرّب إعادة المحاولة.',
        );
      } catch {
        onError('تعذر إيقاف التسجيل الصوتي.');
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
      const asset = result.assets[0];
      await processCapturedAsset(
        {
          kind: 'receipt',
          uri: asset.uri,
          mimeType: asset.mimeType ?? 'image/jpeg',
          ...(asset.base64 ? { base64: asset.base64 } : {}),
        },
        'تعذر قراءة صورة الفاتورة. جرّب إعادة المحاولة.',
      );
    } catch {
      onError('تعذر التقاط صورة الفاتورة.');
    } finally {
      setState('idle');
    }
  }, [onError, onResult, processCapturedAsset, recorder, state]);

  const retry = useCallback(async () => {
    if (!retryableAsset || state !== 'idle') return;
    await processCapturedAsset(
      retryableAsset,
      retryableAsset.kind === 'voice'
        ? 'تعذر تحويل التسجيل الصوتي. جرّب إعادة المحاولة.'
        : 'تعذر قراءة صورة الفاتورة. جرّب إعادة المحاولة.',
    );
  }, [processCapturedAsset, retryableAsset, state]);

  const retryAttachment = useCallback(async (attachment: LocalInputAttachment) => {
    if (state !== 'idle') return;
    await processCapturedAsset(
      {
        kind: attachment.kind,
        uri: attachment.localUri,
        mimeType: attachment.mimeType,
      },
      attachment.kind === 'voice'
        ? 'تعذر إعادة تحويل التسجيل الصوتي. جرّب مرة أخرى.'
        : 'تعذر إعادة قراءة صورة الفاتورة. جرّب مرة أخرى.',
    );
  }, [processCapturedAsset, state]);

  return {
    state,
    canRetry: Boolean(retryableAsset) && state === 'idle',
    retry,
    retryAttachment,
    toggleVoice,
    pickReceipt,
  };
}