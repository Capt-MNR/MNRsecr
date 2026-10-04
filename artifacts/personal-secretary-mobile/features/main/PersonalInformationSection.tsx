import { Feather } from '@expo/vector-icons';
import {
  getListSecondBrainMemoriesQueryKey,
  useArchiveSecondBrainMemory,
  useCreateSecondBrainMemory,
  useEditSecondBrainMemory,
  useListSecondBrainMemories,
  type SecondBrainMemory,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { useColors } from '@/hooks/useColors';
import type { AppLanguage } from '@/hooks/useLanguage';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';

type ProfileKey =
  | 'profile.preferred_name'
  | 'profile.work_or_study'
  | 'profile.usual_schedule'
  | 'profile.current_priorities'
  | 'profile.communication_preference';
type ProfileField = { key: ProfileKey; kind: 'fact' | 'preference'; ar: string; en: string; hintAr: string; hintEn: string };

const fields: ProfileField[] = [
  { key: 'profile.preferred_name', kind: 'preference', ar: 'الاسم الذي تفضله', en: 'Preferred name', hintAr: 'كيف تحب أن أناديك؟', hintEn: 'What should I call you?' },
  { key: 'profile.work_or_study', kind: 'fact', ar: 'العمل أو الدراسة', en: 'Work or study', hintAr: 'دورك أو مجال دراستك', hintEn: 'Your role or field of study' },
  { key: 'profile.usual_schedule', kind: 'fact', ar: 'جدولك المعتاد', en: 'Usual schedule', hintAr: 'الأوقات أو النمط الذي تود حفظه', hintEn: 'The routine you want remembered' },
  { key: 'profile.current_priorities', kind: 'fact', ar: 'أولوياتك الحالية', en: 'Current priorities', hintAr: 'ما الذي يشغل تركيزك الآن؟', hintEn: 'What has your focus right now?' },
  { key: 'profile.communication_preference', kind: 'preference', ar: 'تفضيل التواصل', en: 'Communication preference', hintAr: 'مثال: إجابات مختصرة ومباشرة', hintEn: 'For example: concise, direct replies' },
];

function copy(language: AppLanguage, ar: string, en: string) {
  return language === 'ar' ? ar : en;
}

export function PersonalInformationSection({
  colors,
  language,
  onBack,
  onOpenMemoryLibrary,
}: {
  colors: ReturnType<typeof useColors>;
  language: AppLanguage;
  onBack: () => void;
  onOpenMemoryLibrary: () => void;
}) {
  const queryClient = useQueryClient();
  const rtl = language === 'ar';
  const params = useMemo(() => ({ status: 'active' as const }), []);
  const memoriesQuery = useListSecondBrainMemories(params, {
    query: { queryKey: getListSecondBrainMemoriesQueryKey(params), staleTime: 0 },
  });
  const createMemory = useCreateSecondBrainMemory();
  const editMemory = useEditSecondBrainMemory();
  const archiveMemory = useArchiveSecondBrainMemory();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const activeMemories = memoriesQuery.data?.memories ?? [];
  const byKey = new Map<string, SecondBrainMemory>(activeMemories.map((memory) => [memory.key, memory]));

  function valueFor(key: string) {
    return drafts[key] ?? byKey.get(key)?.value ?? '';
  }

  function saveField(field: ProfileField) {
    const value = valueFor(field.key).trim();
    if (!value || savingKey) return;
    const existing = byKey.get(field.key);
    setSavingKey(field.key);
    setSaveError(null);
    const onSuccess = async () => {
      await queryClient.invalidateQueries({ queryKey: getListSecondBrainMemoriesQueryKey() });
      setDrafts((current) => { const next = { ...current }; delete next[field.key]; return next; });
      setSavingKey(null);
    };
    const onError = () => {
      setSaveError(copy(language, 'تعذر حفظ التغيير. حاول مرة أخرى.', 'Could not save this change. Try again.'));
      setSavingKey(null);
    };
    if (existing) {
      editMemory.mutate({ memoryId: existing.id, data: { value, expectedRevision: existing.revision } }, { onSuccess, onError });
    } else {
      createMemory.mutate({ data: { kind: field.kind, key: field.key, value } }, { onSuccess, onError });
    }
  }

  function removeField(field: ProfileField) {
    const existing = byKey.get(field.key);
    if (!existing || savingKey || archiveMemory.isPending) return;
    setSavingKey(field.key);
    setSaveError(null);
    archiveMemory.mutate({ memoryId: existing.id }, {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getListSecondBrainMemoriesQueryKey() });
        setDrafts((current) => { const next = { ...current }; delete next[field.key]; return next; });
        setSavingKey(null);
      },
      onError: () => {
        setSaveError(copy(language, 'تعذر إزالة المعلومة من الذاكرة.', 'Could not remove this item from memory.'));
        setSavingKey(null);
      },
    });
  }

  return (
    <KeyboardAwareScrollViewCompat contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" bottomOffset={24}>
      <View style={[styles.heading, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
        <Pressable testID="personal-information-back" accessibilityRole="button" accessibilityLabel={copy(language, 'عودة', 'Back')} onPress={onBack} style={[styles.back, { borderColor: colors.border }]}>
          <Feather name={rtl ? 'arrow-right' : 'arrow-left'} size={17} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground, textAlign: rtl ? 'right' : 'left' }]}>{copy(language, 'معلوماتك الشخصية', 'Personal information')}</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground, textAlign: rtl ? 'right' : 'left' }]}>{copy(language, 'أنت تختار ما يبقى في ملفك.', 'You choose what stays in your profile.')}</Text>
        </View>
        <View style={[styles.icon, { backgroundColor: colors.muted }]}><Feather name="user" size={17} color={colors.primary} /></View>
      </View>

      <View style={[styles.privacyNote, { backgroundColor: colors.muted, borderColor: colors.border, flexDirection: rtl ? 'row-reverse' : 'row' }]}>
        <Feather name="shield" size={16} color={colors.primary} />
        <Text style={[styles.privacyText, { color: colors.mutedForeground, textAlign: rtl ? 'right' : 'left' }]}>
          {copy(language, 'لا يتعلم السكرتير هذه التفاصيل بصمت. احفظ فقط ما تريد استخدامه، ويمكنك تعديله أو أرشفته في أي وقت.', 'The assistant does not silently learn these details. Save only what you want it to use; edit or archive them any time.')}
        </Text>
      </View>

      {memoriesQuery.isLoading ? (
        <View style={[styles.stateCard, { backgroundColor: colors.card, borderColor: colors.border }]}><ActivityIndicator color={colors.primary} /><Text style={[styles.helper, { color: colors.mutedForeground }]}>{copy(language, 'جارٍ تحميل ملفك…', 'Loading your profile…')}</Text></View>
      ) : memoriesQuery.isError ? (
        <View style={[styles.stateCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.helper, { color: colors.destructive }]}>{copy(language, 'تعذر تحميل المعلومات الشخصية.', 'Could not load personal information.')}</Text>
          <Pressable onPress={() => void memoriesQuery.refetch()} style={[styles.retry, { borderColor: colors.border }]}><Text style={{ color: colors.primary, fontWeight: '700' }}>{copy(language, 'حاول مرة أخرى', 'Try again')}</Text></Pressable>
        </View>
      ) : (
        <View style={[styles.profileCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.eyebrow, { color: colors.primary, textAlign: rtl ? 'right' : 'left' }]}>{copy(language, 'ملفك', 'YOUR PROFILE')}</Text>
          {fields.map((field, index) => {
            const currentValue = valueFor(field.key);
            const changed = currentValue.trim() !== (byKey.get(field.key)?.value ?? '');
            return (
              <View key={field.key} style={[styles.field, index < fields.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
                <View style={[styles.fieldTop, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.fieldTitle, { color: colors.foreground, textAlign: rtl ? 'right' : 'left' }]}>{copy(language, field.ar, field.en)}</Text>
                    <Text style={[styles.fieldHint, { color: colors.mutedForeground, textAlign: rtl ? 'right' : 'left' }]}>{copy(language, field.hintAr, field.hintEn)}</Text>
                  </View>
                  <Text style={[styles.kindTag, { color: colors.primary, backgroundColor: colors.muted }]}>{field.kind === 'preference' ? copy(language, 'تفضيل', 'Preference') : copy(language, 'معلومة', 'Fact')}</Text>
                </View>
                <TextInput
                  value={currentValue}
                  onChangeText={(value) => setDrafts((current) => ({ ...current, [field.key]: value }))}
                  placeholder={copy(language, 'غير محفوظ', 'Not saved')}
                  placeholderTextColor={colors.mutedForeground}
                  maxLength={320}
                  accessibilityLabel={copy(language, field.ar, field.en)}
                  multiline
                  style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border, textAlign: rtl ? 'right' : 'left' }]}
                />
                <View style={[styles.fieldActions, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
                  {byKey.has(field.key) && <Text style={[styles.savedNote, { color: colors.mutedForeground }]}>{copy(language, 'حُفظت في ذاكرتك', 'Saved to your memory')}</Text>}
                  {byKey.has(field.key) && (
                    <Pressable
                      testID={`profile-archive-${field.key}`}
                      accessibilityRole="button"
                      accessibilityLabel={copy(language, `إزالة ${field.ar} من الذاكرة`, `Remove ${field.en} from memory`)}
                      disabled={Boolean(savingKey) || archiveMemory.isPending}
                      onPress={() => removeField(field)}
                      style={[styles.removeButton, { borderColor: colors.border, opacity: savingKey || archiveMemory.isPending ? 0.5 : 1 }]}
                    >
                      {savingKey === field.key && archiveMemory.isPending
                        ? <ActivityIndicator size="small" color={colors.destructive} />
                        : <Feather name="trash-2" size={14} color={colors.destructive} />}
                    </Pressable>
                  )}
                  <Pressable
                    testID={`profile-save-${field.key}`}
                    accessibilityRole="button"
                    disabled={!changed || !currentValue.trim() || Boolean(savingKey)}
                    onPress={() => saveField(field)}
                    style={[styles.saveButton, { backgroundColor: colors.primary, opacity: !changed || !currentValue.trim() || Boolean(savingKey) ? 0.45 : 1 }]}
                  >
                    {savingKey === field.key ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Feather name="check" size={13} color={colors.primaryForeground} />}
                    <Text style={[styles.saveText, { color: colors.primaryForeground }]}>{copy(language, 'حفظ', 'Save')}</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
          {saveError && <Text accessibilityLiveRegion="polite" style={[styles.error, { color: colors.destructive }]}>{saveError}</Text>}
        </View>
      )}

      <Pressable
        testID="open-memory-library"
        accessibilityRole="button"
        onPress={onOpenMemoryLibrary}
        style={({ pressed }) => [styles.libraryLink, { borderColor: colors.border, backgroundColor: colors.card, flexDirection: rtl ? 'row-reverse' : 'row', opacity: pressed ? 0.68 : 1 }]}
      >
        <View style={[styles.libraryIcon, { backgroundColor: colors.muted }]}><Feather name="database" size={16} color={colors.primary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.libraryTitle, { color: colors.foreground, textAlign: rtl ? 'right' : 'left' }]}>{copy(language, 'مكتبة الذاكرة', 'Memory library')}</Text>
          <Text style={[styles.fieldHint, { color: colors.mutedForeground, textAlign: rtl ? 'right' : 'left' }]}>{copy(language, 'راجع التفاصيل المحفوظة وأدرها أو استرجع المؤرشف.', 'Review, edit, archive, or restore saved details.')}</Text>
        </View>
        <Feather name={rtl ? 'chevron-left' : 'chevron-right'} size={16} color={colors.mutedForeground} />
      </Pressable>
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 115, gap: 14 },
  heading: { alignItems: 'center', gap: 12, marginBottom: 3 },
  back: { width: 38, height: 38, borderWidth: 1, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  icon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' },
  subtitle: { marginTop: 3, fontSize: 12 },
  privacyNote: { borderWidth: 1, borderRadius: 16, padding: 13, gap: 10, alignItems: 'flex-start' },
  privacyText: { flex: 1, fontSize: 11, lineHeight: 18 },
  profileCard: { borderWidth: 1, borderRadius: 20, padding: 16 },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.1, marginBottom: 3 },
  field: { paddingVertical: 14, gap: 9 },
  fieldTop: { alignItems: 'flex-start', gap: 8 },
  fieldTitle: { fontSize: 13, fontWeight: '700' },
  fieldHint: { marginTop: 3, fontSize: 10, lineHeight: 15 },
  kindTag: { overflow: 'hidden', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 4, fontSize: 9, fontWeight: '700' },
  input: { minHeight: 43, maxHeight: 100, borderWidth: 1, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9, fontSize: 12, lineHeight: 18 },
  fieldActions: { alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  savedNote: { flex: 1, fontSize: 9 },
  removeButton: { width: 31, height: 31, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  saveButton: { minHeight: 31, borderRadius: 10, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  saveText: { fontSize: 10, fontWeight: '700' },
  stateCard: { minHeight: 130, borderWidth: 1, borderRadius: 18, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20 },
  helper: { fontSize: 11, lineHeight: 17, textAlign: 'center' },
  retry: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 8 },
  error: { fontSize: 11, paddingTop: 4 },
  libraryLink: { minHeight: 76, borderWidth: 1, borderRadius: 18, padding: 13, alignItems: 'center', gap: 11 },
  libraryIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  libraryTitle: { fontSize: 13, fontWeight: '700' },
});