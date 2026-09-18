import {
  getListSecondBrainMemoriesQueryKey,
  type ListSecondBrainMemoriesParams,
  useArchiveSecondBrainMemory,
  useListSecondBrainMemories,
  type SecondBrainMemory,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { AppLanguage } from '@/hooks/useLanguage';
import type { useColors } from '@/hooks/useColors';

function localized(language: AppLanguage, arabic: string, english: string) {
  return language === 'ar' ? arabic : english;
}

function kindLabel(language: AppLanguage, kind: SecondBrainMemory['kind']) {
  if (kind === 'preference') return localized(language, 'تفضيل', 'Preference');
  if (kind === 'alias') return localized(language, 'اسم بديل', 'Alias');
  return localized(language, 'معلومة', 'Fact');
}

function formatDate(language: AppLanguage, value: Date | string | null) {
  if (!value) return localized(language, 'غير متاح', 'Not available');
  return new Intl.DateTimeFormat(language === 'ar' ? 'ar-EG' : 'en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

export function SecondBrainMemorySheet({
  colors,
  language,
  visible,
  onClose,
}: {
  colors: ReturnType<typeof useColors>;
  language: AppLanguage;
  visible: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<ListSecondBrainMemoriesParams['kind']>();
  const [status, setStatus] = useState<NonNullable<ListSecondBrainMemoriesParams['status']>>('active');
  const filters: ListSecondBrainMemoriesParams = {
    ...(search ? { search } : {}),
    ...(kind ? { kind } : {}),
    status,
  };
  const memoriesQuery = useListSecondBrainMemories(filters, {
    query: {
      queryKey: getListSecondBrainMemoriesQueryKey(filters),
      enabled: visible,
      staleTime: 0,
    },
  });
  const archiveMutation = useArchiveSecondBrainMemory({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getListSecondBrainMemoriesQueryKey() });
        setArchivingId(null);
      },
      onError: () => setArchivingId(null),
    },
  });

  function archiveMemory(id: string) {
    if (archiveMutation.isPending) return;
    setArchivingId(id);
    archiveMutation.mutate({ memoryId: id });
  }

  const memories = memoriesQuery.data?.memories ?? [];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View style={styles.headerCopy}>
              <View style={[styles.iconBubble, { backgroundColor: colors.primary }]}>
                <Feather name="database" size={16} color={colors.primaryForeground} />
              </View>
              <View style={styles.headerText}>
                <Text style={[styles.title, { color: colors.foreground }]}>
                  {localized(language, 'الذاكرة الشخصية', 'Personal memory')}
                </Text>
                <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                  {localized(language, 'معلومات حفظتها أنت صراحةً', 'Only information you explicitly saved')}
                </Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={localized(language, 'إغلاق الذاكرة', 'Close memory')}
              onPress={onClose}
              style={[styles.close, { borderColor: colors.border }]}
            >
              <Feather name="x" size={17} color={colors.foreground} />
            </Pressable>
          </View>

          {memoriesQuery.isLoading ? (
            <View style={styles.centerState}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : memoriesQuery.isError ? (
            <View style={styles.centerState}>
              <Text style={[styles.stateText, { color: colors.destructive }]}>
                {localized(language, 'تعذر تحميل الذاكرة.', 'Could not load personal memory.')}
              </Text>
              <Pressable onPress={() => void memoriesQuery.refetch()} style={[styles.retry, { borderColor: colors.border }]}>
                <Text style={[styles.retryText, { color: colors.primary }]}>
                  {localized(language, 'حاول مرة أخرى', 'Try again')}
                </Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
              <Text style={[styles.explainer, { color: colors.mutedForeground }]}>
                {localized(
                  language,
                  'يمكنك إزالة أي ذاكرة دون التأثير على المحادثات أو السجلات الرسمية.',
                  'Remove a memory without changing conversations or official records.',
                )}
              </Text>
              <View style={[styles.searchBox, { borderColor: colors.border, backgroundColor: colors.card }]}>
                <Feather name="search" size={15} color={colors.mutedForeground} />
                <TextInput
                  value={searchDraft}
                  onChangeText={setSearchDraft}
                  onSubmitEditing={() => setSearch(searchDraft.trim())}
                  returnKeyType="search"
                  placeholder={localized(language, 'ابحث في الذاكرة', 'Search memory')}
                  placeholderTextColor={colors.mutedForeground}
                  style={[styles.searchInput, { color: colors.foreground }]}
                  accessibilityLabel={localized(language, 'البحث في الذاكرة', 'Search personal memory')}
                />
                {searchDraft.length > 0 && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={localized(language, 'مسح البحث', 'Clear search')}
                    onPress={() => {
                      setSearchDraft('');
                      setSearch('');
                    }}
                    style={styles.clearSearch}
                  >
                    <Feather name="x" size={14} color={colors.mutedForeground} />
                  </Pressable>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={localized(language, 'تطبيق البحث', 'Apply search')}
                  onPress={() => setSearch(searchDraft.trim())}
                  style={[styles.searchButton, { backgroundColor: colors.primary }]}
                >
                  <Text style={[styles.searchButtonText, { color: colors.primaryForeground }]}>
                    {localized(language, 'بحث', 'Search')}
                  </Text>
                </Pressable>
              </View>
              <View style={styles.filterRow}>
                {([
                  [undefined, 'الكل', 'All'],
                  ['fact', 'معلومات', 'Facts'],
                  ['preference', 'تفضيلات', 'Preferences'],
                  ['alias', 'أسماء بديلة', 'Aliases'],
                ] as const).map(([value, arabicLabel, englishLabel]) => (
                  <Pressable
                    key={value ?? 'all'}
                    accessibilityRole="button"
                    accessibilityState={{ selected: kind === value }}
                    onPress={() => setKind(value)}
                    style={[
                      styles.filterChip,
                      { borderColor: colors.border, backgroundColor: kind === value ? colors.primary : colors.muted },
                    ]}
                  >
                    <Text style={[styles.filterChipText, { color: kind === value ? colors.primaryForeground : colors.mutedForeground }]}>
                      {localized(language, arabicLabel, englishLabel)}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.filterRow}>
                {([
                  ['active', 'النشطة', 'Active'],
                  ['archived', 'الأرشيف', 'Archived'],
                ] as const).map(([value, arabicLabel, englishLabel]) => (
                  <Pressable
                    key={value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: status === value }}
                    onPress={() => setStatus(value)}
                    style={[
                      styles.filterChip,
                      { borderColor: colors.border, backgroundColor: status === value ? colors.foreground : colors.muted },
                    ]}
                  >
                    <Text style={[styles.filterChipText, { color: status === value ? colors.background : colors.mutedForeground }]}>
                      {localized(language, arabicLabel, englishLabel)}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {memories.length === 0 ? (
                <View style={[styles.empty, { borderColor: colors.border }]}>
                  <Feather name="star" size={20} color={colors.primary} />
                  <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                    {search || kind
                      ? localized(language, 'لا توجد نتائج مطابقة', 'No matching memories')
                      : status === 'archived'
                        ? localized(language, 'لا توجد ذاكرة مؤرشفة', 'No archived memories')
                        : localized(language, 'لا توجد ذاكرة محفوظة', 'No saved memories')}
                  </Text>
                  <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                    {search || kind
                      ? localized(language, 'جرّب تغيير البحث أو التصفية.', 'Try changing the search or filter.')
                      : localized(language, 'قل: «افتكر إني بفضل الردود المختصرة».', 'Say: “Remember that I prefer concise replies.”')}
                  </Text>
                </View>
              ) : memories.map((memory) => {
                const isArchiving = archivingId === memory.id;
                return (
                  <View key={memory.id} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.background }]}>
                    <View style={styles.cardTop}>
                      <View style={styles.cardCopy}>
                        <Text style={[styles.kind, { color: colors.primary }]}>{kindLabel(language, memory.kind)}</Text>
                        <Text style={[styles.value, { color: colors.foreground }]}>{memory.value}</Text>
                      </View>
                      {status === 'active' && <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={localized(language, `إزالة ${memory.value}`, `Remove ${memory.value}`)}
                        disabled={archiveMutation.isPending}
                        onPress={() => archiveMemory(memory.id)}
                        style={[styles.archive, { borderColor: colors.border, opacity: archiveMutation.isPending ? 0.55 : 1 }]}
                      >
                        {isArchiving
                          ? <ActivityIndicator size="small" color={colors.destructive} />
                          : <Feather name="trash-2" size={15} color={colors.destructive} />}
                      </Pressable>}
                    </View>
                    <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                      {localized(language, 'آخر تأكيد', 'Confirmed')} · {formatDate(language, memory.lastConfirmedAt)}
                      {status === 'archived' ? ` · ${localized(language, 'مؤرشفة', 'Archived')}` : ''}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(8, 20, 38, 0.35)',
  },
  sheet: {
    maxHeight: '88%',
    minHeight: 360,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerCopy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    flex: 1,
  },
  iconBubble: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
  },
  subtitle: {
    marginTop: 3,
    fontSize: 11,
  },
  close: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: 20,
    gap: 12,
    paddingBottom: 34,
  },
  explainer: {
    fontSize: 12,
    lineHeight: 20,
    marginBottom: 3,
  },
  searchBox: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
  },
  searchInput: {
    flex: 1,
    minHeight: 40,
    fontSize: 13,
    textAlign: 'right',
  },
  clearSearch: {
    padding: 4,
  },
  searchButton: {
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  searchButtonText: {
    fontSize: 11,
    fontWeight: '700',
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  filterChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  filterChipText: {
    fontSize: 10,
    fontWeight: '700',
  },
  card: {
    borderWidth: 1,
    borderRadius: 17,
    padding: 14,
    gap: 10,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  cardCopy: {
    flex: 1,
    gap: 6,
  },
  kind: {
    fontSize: 11,
    fontWeight: '700',
  },
  value: {
    fontSize: 14,
    lineHeight: 22,
  },
  archive: {
    width: 34,
    height: 34,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: {
    fontSize: 10,
  },
  empty: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 18,
    alignItems: 'center',
    padding: 25,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  emptyText: {
    fontSize: 12,
    lineHeight: 19,
    textAlign: 'center',
  },
  centerState: {
    flex: 1,
    minHeight: 280,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 20,
  },
  stateText: {
    fontSize: 13,
    textAlign: 'center',
  },
  retry: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  retryText: {
    fontSize: 12,
    fontWeight: '700',
  },
});