export const RECORD_REFRESH_FAILURE_MESSAGE =
  'تعذر تحديث السجل قبل التعديل. لم نفتح نسخة قديمة. تحقق من الاتصال وحاول مرة أخرى.';

type RefreshResult<T> = {
  isSuccess: boolean;
  data?: T[] | null;
};

export function resolveRecordForEditing<T extends { id: string }>(
  refreshResult: RefreshResult<T>,
  recordId: string,
):
  | { status: 'ready'; record: T }
  | { status: 'missing' }
  | { status: 'refresh_failed' } {
  if (!refreshResult.isSuccess || !refreshResult.data) {
    return { status: 'refresh_failed' };
  }

  const record = refreshResult.data.find((candidate) => candidate.id === recordId);
  return record ? { status: 'ready', record } : { status: 'missing' };
}