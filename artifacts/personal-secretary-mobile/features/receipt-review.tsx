import { Feather } from '@expo/vector-icons';
import type { InputAssetProcessResponse } from '@workspace/api-client-react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { AppLanguage } from '@/hooks/useLanguage';
import { useColors } from '@/hooks/useColors';

type ReceiptReviewProps = {
  result: InputAssetProcessResponse;
  colors: ReturnType<typeof useColors>;
  language: AppLanguage;
  onChange: (result: InputAssetProcessResponse) => void;
  onClear: () => void;
};

function copy(language: AppLanguage, arabic: string, english: string): string {
  return language === 'en' ? english : arabic;
}

function amountText(amountMinor: number | null): string {
  if (amountMinor === null) return '';
  return (amountMinor / 100).toFixed(2).replace(/\.00$/, '');
}

export function ReceiptReviewCard({
  result,
  colors,
  language,
  onChange,
  onClear,
}: ReceiptReviewProps) {
  if (result.kind !== 'receipt' || !result.receipt) return null;
  const receipt = result.receipt;
  const update = (field: keyof NonNullable<InputAssetProcessResponse['receipt']>, value: string) => {
    const nextReceipt = {
      ...receipt,
      [field]: field === 'amountMinor'
        ? (value.trim() ? Math.round(Number(value) * 100) : null)
        : value.trim() || null,
    };
    onChange({
      ...result,
      receipt: nextReceipt,
      ...(field === 'description' ? { text: value.trim() || result.text } : {}),
    });
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {copy(language, 'راجع بيانات الفاتورة', 'Review receipt details')}
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {copy(language, 'لن يتم تسجيل المصروف قبل إرسال المسودة.', 'Nothing is recorded until you send the draft.')}
          </Text>
        </View>
        <View style={[styles.confidence, { backgroundColor: colors.muted }]}>
          <Feather name="check-circle" size={13} color={colors.primary} />
          <Text style={[styles.confidenceText, { color: colors.primary }]}>
            {Math.round(receipt.confidence * 100)}%
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy(language, 'إلغاء مراجعة الفاتورة', 'Clear receipt review')}
          onPress={onClear}
          style={({ pressed }) => ({ padding: 3, opacity: pressed ? 0.55 : 1 })}
        >
          <Feather name="x" size={16} color={colors.mutedForeground} />
        </Pressable>
      </View>

      <View style={styles.fields}>
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>{copy(language, 'التاجر', 'Merchant')}</Text>
          <TextInput
            value={receipt.merchant ?? ''}
            onChangeText={(value) => update('merchant', value)}
            placeholder={copy(language, 'اسم التاجر', 'Merchant name')}
            placeholderTextColor={colors.mutedForeground}
            textAlign="right"
            style={[styles.input, { color: colors.foreground, borderColor: colors.input }]}
          />
        </View>
        <View style={styles.row}>
          <View style={[styles.field, styles.halfField]}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>{copy(language, 'المبلغ', 'Amount')}</Text>
            <TextInput
              value={amountText(receipt.amountMinor)}
              onChangeText={(value) => update('amountMinor', value)}
              placeholder="0"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="decimal-pad"
              textAlign="right"
              style={[styles.input, { color: colors.foreground, borderColor: colors.input }]}
            />
          </View>
          <View style={[styles.field, styles.halfField]}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>{copy(language, 'العملة', 'Currency')}</Text>
            <TextInput
              value={receipt.currency ?? ''}
              onChangeText={(value) => update('currency', value)}
              placeholder="EGP"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="characters"
              textAlign="right"
              style={[styles.input, { color: colors.foreground, borderColor: colors.input }]}
            />
          </View>
        </View>
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>{copy(language, 'الوصف', 'Description')}</Text>
          <TextInput
            value={receipt.description ?? result.text}
            onChangeText={(value) => update('description', value)}
            placeholder={copy(language, 'وصف المصروف', 'Expense description')}
            placeholderTextColor={colors.mutedForeground}
            textAlign="right"
            style={[styles.input, { color: colors.foreground, borderColor: colors.input }]}
          />
        </View>
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>{copy(language, 'التاريخ', 'Date')}</Text>
          <TextInput
            value={receipt.occurredAt ?? ''}
            onChangeText={(value) => update('occurredAt', value)}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.mutedForeground}
            textAlign="right"
            style={[styles.input, { color: colors.foreground, borderColor: colors.input }]}
          />
        </View>
      </View>
    </View>
  );
}

const styles = {
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 10,
    gap: 9,
  },
  header: {
    flexDirection: 'row-reverse' as const,
    alignItems: 'flex-start' as const,
    gap: 7,
  },
  headerCopy: {
    flex: 1,
    alignItems: 'flex-end' as const,
    gap: 2,
  },
  title: {
    fontSize: 12,
    fontWeight: '700' as const,
    textAlign: 'right' as const,
  },
  subtitle: {
    fontSize: 10,
    lineHeight: 15,
    textAlign: 'right' as const,
  },
  confidence: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 3,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  confidenceText: {
    fontSize: 10,
    fontWeight: '700' as const,
  },
  fields: {
    gap: 7,
  },
  row: {
    flexDirection: 'row' as const,
    gap: 7,
  },
  field: {
    gap: 3,
  },
  halfField: {
    flex: 1,
  },
  label: {
    fontSize: 10,
    textAlign: 'right' as const,
  },
  input: {
    minHeight: 34,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 12,
  },
};