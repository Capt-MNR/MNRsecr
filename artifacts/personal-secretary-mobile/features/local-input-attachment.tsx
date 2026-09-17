import { Feather } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus, type AudioPlayer } from 'expo-audio';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/hooks/useLanguage';
import type { LocalInputAttachment } from '../services/local-input-assets';

let activeAudioPlayer: AudioPlayer | null = null;

export function LocalInputAttachmentView({
  attachment,
  onRetry,
  retrying = false,
}: {
  attachment: LocalInputAttachment;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const { language } = useLanguage();
  const colors = useColors();
  const player = useAudioPlayer(attachment.kind === 'voice' ? attachment.localUri : null);
  const status = useAudioPlayerStatus(player);
  const [playbackError, setPlaybackError] = useState(false);

  useEffect(() => {
    if (!status.didJustFinish || activeAudioPlayer !== player) return;
    activeAudioPlayer = null;
    void player.seekTo(0);
  }, [player, status.didJustFinish]);

  useEffect(() => () => {
    if (activeAudioPlayer === player) {
      player.pause();
      activeAudioPlayer = null;
    }
  }, [player]);

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
          <View style={styles.captionCopy}>
            <Feather name="image" size={13} color={colors.mutedForeground} />
            <Text style={[styles.captionText, { color: colors.mutedForeground }]}>
              {language === 'en' ? 'Receipt saved on this device' : 'صورة الفاتورة محفوظة على الجهاز'}
            </Text>
          </View>
          {onRetry && (
            <RetryButton
              colors={colors}
              language={language}
              onPress={onRetry}
              retrying={retrying}
            />
          )}
        </View>
      </View>
    );
  }

  function togglePlayback() {
    setPlaybackError(false);
    try {
      if (status.playing) {
        player.pause();
        if (activeAudioPlayer === player) activeAudioPlayer = null;
        return;
      }
      if (activeAudioPlayer && activeAudioPlayer !== player) activeAudioPlayer.pause();
      activeAudioPlayer = player;
      if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration)) {
        void player.seekTo(0);
      }
      player.play();
    } catch {
      if (activeAudioPlayer === player) activeAudioPlayer = null;
      setPlaybackError(true);
    }
  }

  const playbackLabel = playbackError
    ? (language === 'en' ? 'Audio unavailable' : 'التسجيل غير متاح')
    : status.isBuffering
      ? (language === 'en' ? 'Preparing audio…' : 'جاري تجهيز التسجيل…')
      : status.playing
        ? (language === 'en' ? 'Pause recording' : 'إيقاف التسجيل')
        : (language === 'en' ? 'Play recording' : 'تشغيل التسجيل');

  return (
    <View style={[styles.audioCard, { borderColor: colors.border, backgroundColor: colors.muted }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={playbackLabel}
        accessibilityState={{ busy: status.isBuffering }}
        disabled={status.isBuffering}
        onPress={togglePlayback}
        style={({ pressed }) => [
          styles.audioButton,
          { backgroundColor: colors.primary, opacity: pressed || status.isBuffering ? 0.6 : 1 },
        ]}
      >
        <Feather name={status.playing ? 'pause' : 'play'} size={14} color={colors.primaryForeground} />
      </Pressable>
      <View style={styles.audioCopy}>
        <Text style={[styles.audioTitle, { color: colors.foreground }]}>
          {language === 'en' ? 'Voice recording' : 'تسجيل صوتي'}
        </Text>
        <Text style={[styles.audioText, { color: colors.mutedForeground }]}>
          {playbackError
            ? (language === 'en' ? 'The local file is unavailable' : 'الملف المحلي غير متاح')
            : language === 'en'
              ? 'Saved on this device'
              : 'محفوظ على الجهاز'}
        </Text>
      </View>
      {onRetry && (
        <RetryButton
          colors={colors}
          language={language}
          onPress={onRetry}
          retrying={retrying}
        />
      )}
      <Feather name="mic" size={16} color={colors.primary} />
    </View>
  );
}

function RetryButton({
  colors,
  language,
  onPress,
  retrying,
}: {
  colors: ReturnType<typeof useColors>;
  language: 'ar' | 'en';
  onPress: () => void;
  retrying: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={language === 'en' ? 'Use this input again' : 'إعادة استخدام هذا الإدخال'}
      accessibilityState={{ busy: retrying }}
      disabled={retrying}
      onPress={onPress}
      style={({ pressed }) => [
        styles.retryButton,
        { borderColor: colors.border, opacity: pressed || retrying ? 0.55 : 1 },
      ]}
    >
      {retrying
        ? <ActivityIndicator size="small" color={colors.primary} />
        : <Feather name="rotate-ccw" size={12} color={colors.primary} />}
      <Text style={[styles.retryText, { color: colors.primary }]}>
        {retrying
          ? (language === 'en' ? 'Reading…' : 'جاري القراءة…')
          : (language === 'en' ? 'Use again' : 'إعادة استخدام')}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginTop: 9, overflow: 'hidden', borderRadius: 12, borderWidth: 1, borderColor: '#dfe5f3' },
  receipt: { width: 180, height: 112, backgroundColor: '#edf1ff' },
  caption: { minHeight: 34, paddingHorizontal: 8, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 6, backgroundColor: '#f7f8fc' },
  captionCopy: { flex: 1, flexDirection: 'row-reverse', alignItems: 'center', gap: 5 },
  captionText: { fontSize: 10, color: '#687594', textAlign: 'right' },
  audioCard: { marginTop: 9, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: '#dfe5f3', paddingHorizontal: 10, flexDirection: 'row-reverse', alignItems: 'center', gap: 8, backgroundColor: '#f7f8fc' },
  audioButton: { width: 28, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  audioCopy: { flex: 1, gap: 2 },
  audioTitle: { fontSize: 11, fontWeight: '700', color: '#15213d', textAlign: 'right' },
  audioText: { fontSize: 10, color: '#687594', textAlign: 'right' },
  retryButton: { minHeight: 26, borderRadius: 8, borderWidth: 1, paddingHorizontal: 6, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 4 },
  retryText: { fontSize: 9, fontWeight: '700' },
});