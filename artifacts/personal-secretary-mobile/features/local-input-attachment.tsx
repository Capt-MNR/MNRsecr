import { Feather } from '@expo/vector-icons';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/hooks/useLanguage';
import type { LocalInputAttachment } from '../services/local-input-assets';

export function LocalInputAttachmentView({ attachment }: { attachment: LocalInputAttachment }) {
  const { language } = useLanguage();
  const colors = useColors();
  if (attachment.kind === 'receipt') {
    return (
      <View style={[styles.wrapper, { borderColor: colors.border }]}>
        <Image
          accessibilityLabel={language === 'en' ? 'Saved receipt image' : 'صورة الفاتورة المحفوظة'}
          source={{ uri: attachment.localUri }}
          style={[styles.receipt, { backgroundColor: colors.muted }]}
          resizeMode="cover"
        />
        <View style={[styles.caption, { backgroundColor: colors.muted }]}>
          <Feather name="image" size={13} color={colors.mutedForeground} />
          <Text style={[styles.captionText, { color: colors.mutedForeground }]}>
            {language === 'en' ? 'Receipt saved on this device' : 'صورة الفاتورة محفوظة على الجهاز'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.audioCard, { borderColor: colors.border, backgroundColor: colors.muted }]}>
      <Feather name="mic" size={16} color={colors.primary} />
      <View style={styles.audioCopy}>
        <Text style={[styles.audioTitle, { color: colors.foreground }]}>
          {language === 'en' ? 'Voice recording' : 'تسجيل صوتي'}
        </Text>
        <Text style={[styles.audioText, { color: colors.mutedForeground }]}>
          {language === 'en' ? 'Saved on this device for retry' : 'محفوظ على الجهاز لإعادة المحاولة'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginTop: 9, overflow: 'hidden', borderRadius: 12, borderWidth: 1, borderColor: '#dfe5f3' },
  receipt: { width: 180, height: 112, backgroundColor: '#edf1ff' },
  caption: { minHeight: 28, paddingHorizontal: 8, flexDirection: 'row-reverse', alignItems: 'center', gap: 5, backgroundColor: '#f7f8fc' },
  captionText: { fontSize: 10, color: '#687594', textAlign: 'right' },
  audioCard: { marginTop: 9, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: '#dfe5f3', paddingHorizontal: 10, flexDirection: 'row-reverse', alignItems: 'center', gap: 8, backgroundColor: '#f7f8fc' },
  audioCopy: { flex: 1, gap: 2 },
  audioTitle: { fontSize: 11, fontWeight: '700', color: '#15213d', textAlign: 'right' },
  audioText: { fontSize: 10, color: '#687594', textAlign: 'right' },
});