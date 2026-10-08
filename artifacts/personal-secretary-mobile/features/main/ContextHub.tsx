import { Feather } from '@expo/vector-icons';
import type { AppLanguage } from '@/hooks/useLanguage';
import { useColors } from '@/hooks/useColors';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

type Props = {
  language: AppLanguage;
  onOpenPeople: () => void;
  onOpenProjects: () => void;
  onOpenRecords: () => void;
  onOpenMemory: () => void;
  onOpenConnections: () => void;
  onBack?: () => void;
};

const copy = (language: AppLanguage, ar: string, en: string) => language === 'en' ? en : ar;

export default function ContextHub({ language, onOpenPeople, onOpenProjects, onOpenRecords, onOpenMemory, onOpenConnections, onBack }: Props) {
  const colors = useColors();
  const rtl = language === 'ar';
  const links = [
    { key: 'people', icon: 'users' as const, title: copy(language, 'الأشخاص', 'People'), description: copy(language, 'الأسماء والعلاقات المرتبطة بحياتك', 'People and the relationships around your life'), action: onOpenPeople, number: '01' },
    { key: 'projects', icon: 'layers' as const, title: copy(language, 'المشاريع', 'Projects'), description: copy(language, 'العمل النشط وسياقه المتصل', 'Active work and its connected context'), action: onOpenProjects, number: '02' },
    { key: 'records', icon: 'archive' as const, title: copy(language, 'السجلات', 'Structured records'), description: copy(language, 'مهام وتذكيرات ومصروفات والتزامات', 'Tasks, reminders, expenses and commitments'), action: onOpenRecords, number: '03' },
    { key: 'memory', icon: 'bookmark' as const, title: copy(language, 'الذاكرة', 'Memory'), description: copy(language, 'ما احتفظ به السكرتير ليستعين به لاحقًا', 'What your secretary remembers for later'), action: onOpenMemory, number: '04' },
  ];

  return (
    <ScrollView testID="context-hub" style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={[styles.header, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
        {onBack && (
          <Pressable testID="context-hub-back" accessibilityRole="button" accessibilityLabel={copy(language, 'عودة', 'Back')} onPress={onBack} style={[styles.back, { borderColor: colors.border }]}>
            <Feather name={rtl ? 'arrow-right' : 'arrow-left'} size={17} color={colors.foreground} />
          </Pressable>
        )}
        <View style={{ flex: 1 }}>
          <Text style={[styles.eyebrow, { color: colors.primary, textAlign: rtl ? 'right' : 'left' }]}>{copy(language, 'ذاكرة وسياق', 'YOUR CONTEXT')}</Text>
          <Text style={[styles.title, { color: colors.foreground, textAlign: rtl ? 'right' : 'left' }]}>{copy(language, 'كل شيء في مكانه', 'Everything in its place')}</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground, textAlign: rtl ? 'right' : 'left' }]}>{copy(language, 'سياق واضح، يمكن مراجعته وإدارته.', 'A clear context you can review and manage.')}</Text>
        </View>
      </View>

      <View style={[styles.principle, { backgroundColor: colors.primary }]}>
        <View style={[styles.principleIcon, { backgroundColor: colors.primaryForeground }]}>
          <Feather name="eye" size={17} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.principleTitle, { color: colors.primaryForeground, textAlign: rtl ? 'right' : 'left' }]}>{copy(language, 'تذكّر، لا تتصرّف من تلقاء نفسه', 'Remember first. Ask before acting.')}</Text>
          <Text style={[styles.principleText, { color: colors.primaryForeground, opacity: 0.78, textAlign: rtl ? 'right' : 'left' }]}>{copy(language, 'كل معلومة لها مصدر، وكل عمل خارجي ينتظر موافقتك.', 'Context stays inspectable; external work waits for your approval.')}</Text>
        </View>
      </View>

      <View style={styles.links}>
        {links.map((item) => (
          <Pressable
            key={item.key}
            testID={`context-open-${item.key}`}
            accessibilityRole="button"
            accessibilityLabel={item.title}
            onPress={item.action}
            style={({ pressed }) => [styles.link, { backgroundColor: colors.card, borderColor: colors.border, flexDirection: rtl ? 'row-reverse' : 'row', opacity: pressed ? 0.72 : 1 }]}
          >
            <Text style={[styles.ordinal, { color: colors.accent }]}>{item.number}</Text>
            <View style={[styles.linkIcon, { backgroundColor: colors.muted }]}>
              <Feather name={item.icon} size={17} color={colors.primary} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.linkTitle, { color: colors.foreground, textAlign: rtl ? 'right' : 'left' }]}>{item.title}</Text>
              <Text style={[styles.linkDescription, { color: colors.mutedForeground, textAlign: rtl ? 'right' : 'left' }]}>{item.description}</Text>
            </View>
            <Feather name={rtl ? 'chevron-left' : 'chevron-right'} size={17} color={colors.mutedForeground} />
          </Pressable>
        ))}
      </View>

      <Pressable
        testID="context-open-connections"
        accessibilityRole="button"
        accessibilityLabel={copy(language, 'إدارة اتصالات البيانات', 'Manage data connections')}
        onPress={onOpenConnections}
        style={({ pressed }) => [styles.connectionCard, { borderColor: colors.border, backgroundColor: colors.secondary, flexDirection: rtl ? 'row-reverse' : 'row', opacity: pressed ? 0.72 : 1 }]}
      >
        <View style={[styles.linkIcon, { backgroundColor: colors.card }]}>
          <Feather name="link-2" size={17} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.linkTitle, { color: colors.foreground, textAlign: rtl ? 'right' : 'left' }]}>{copy(language, 'اتصالات البيانات', 'Data connections')}</Text>
          <Text style={[styles.linkDescription, { color: colors.mutedForeground, textAlign: rtl ? 'right' : 'left' }]}>{copy(language, 'تحقّق من Gmail وتقويم Google وأذوناتهما', 'Verify Gmail and Google Calendar access')}</Text>
        </View>
        <Feather name={rtl ? 'arrow-left' : 'arrow-right'} size={17} color={colors.primary} />
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, paddingTop: 20, paddingBottom: 36, gap: 20 },
  header: { alignItems: 'center', gap: 12 },
  back: { width: 40, height: 40, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 6 },
  title: { fontSize: 25, lineHeight: 32, fontWeight: '800' },
  subtitle: { fontSize: 12, lineHeight: 18, marginTop: 5 },
  principle: { borderRadius: 22, padding: 17, flexDirection: 'row', gap: 13, alignItems: 'center' },
  principleIcon: { width: 36, height: 36, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  principleTitle: { fontSize: 13, fontWeight: '800', lineHeight: 19 },
  principleText: { fontSize: 10, lineHeight: 16, marginTop: 3 },
  links: { gap: 9 },
  link: { minHeight: 82, borderRadius: 19, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 12, alignItems: 'center', gap: 10 },
  ordinal: { fontSize: 9, fontWeight: '800' },
  linkIcon: { width: 38, height: 38, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  linkTitle: { fontSize: 14, fontWeight: '800' },
  linkDescription: { fontSize: 10, lineHeight: 15, marginTop: 3 },
  connectionCard: { minHeight: 72, borderWidth: StyleSheet.hairlineWidth, borderRadius: 19, padding: 12, alignItems: 'center', gap: 11 },
});
