import { Feather } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useState } from 'react';
import { useColors } from '@/hooks/useColors';
import type { Approval, ApprovalArgs, ApprovalCandidate, LocalMessage, MobileRecordRow } from './shared';
import { styles, starterMessage } from './shared';

function messageTime(value: string) {
  if (value === starterMessage.createdAt) return 'الآن';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'الآن';
  return new Intl.DateTimeFormat('ar-EG', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function amountInputFromArgs(args: ApprovalArgs) {
  const amountMinor = asNumber(args.amountMinor);
  return amountMinor > 0 ? String(amountMinor / 100) : '';
}

function parseAmountMinor(value: string) {
  const normalized = value.trim().replace(',', '.');
  if (!normalized || !/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const amountMinor = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(amountMinor) && amountMinor > 0 ? amountMinor : null;
}

function localDateTimeValue(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function isoFromLocalDateTime(value: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function ApprovalEditor({
  approval,
  colors,
  onApprove,
}: {
  approval: Approval;
  colors: ReturnType<typeof useColors>;
  onApprove: (approval: Approval, args: ApprovalArgs) => void;
}) {
  const toolName = approval.toolName ?? '';
  const initialArgs = approval.initialArgs ?? {};
  const [args, setArgs] = useState<ApprovalArgs>(initialArgs);
  const [amount, setAmount] = useState(() => amountInputFromArgs(initialArgs));
  const [personName, setPersonName] = useState(() => asString(initialArgs.personName));
  const [projectName, setProjectName] = useState(() => asString(initialArgs.projectName));
  const [personId, setPersonId] = useState(() => asString(initialArgs.personId));
  const [projectId, setProjectId] = useState(() => asString(initialArgs.projectId));
  const [personMode, setPersonMode] = useState<'existing' | 'new' | 'none'>(
    () => asString(initialArgs.personId) ? 'existing' : asString(initialArgs.personName) ? 'new' : 'none',
  );
  const [projectMode, setProjectMode] = useState<'existing' | 'new' | 'none'>(
    () => asString(initialArgs.projectId) ? 'existing' : asString(initialArgs.projectName) ? 'new' : 'none',
  );
  const [dueAtInput, setDueAtInput] = useState(() => localDateTimeValue(asString(initialArgs.dueAt)));

  function updateArg(key: string, value: unknown) {
    setArgs((current) => ({ ...current, [key]: value }));
  }

  function selectCandidate(
    candidate: ApprovalCandidate,
    kind: 'person' | 'project',
  ) {
    if (kind === 'person') {
      setPersonMode('existing');
      setPersonId(candidate.id);
      setPersonName(candidate.name);
      updateArg('personId', candidate.id);
      updateArg('personName', candidate.name);
    } else {
      setProjectMode('existing');
      setProjectId(candidate.id);
      setProjectName(candidate.name);
      updateArg('projectId', candidate.id);
      updateArg('projectName', candidate.name);
    }
  }

  function selectUnlinked(kind: 'person' | 'project') {
    if (kind === 'person') {
      setPersonMode('none');
      setPersonId('');
      setPersonName('');
      updateArg('personId', null);
      updateArg('personName', undefined);
    } else {
      setProjectMode('none');
      setProjectId('');
      setProjectName('');
      updateArg('projectId', null);
      updateArg('projectName', undefined);
    }
  }

  function selectNew(kind: 'person' | 'project') {
    if (kind === 'person') {
      setPersonMode('new');
      setPersonId('');
      updateArg('personId', null);
    } else {
      setProjectMode('new');
      setProjectId('');
      updateArg('projectId', null);
    }
  }

  if (toolName === 'record_expense') {
    const amountMinor = parseAmountMinor(amount);
    const description = asString(args.description);
    const nextArgs = {
      ...args,
      amountMinor: amountMinor ?? asNumber(args.amountMinor),
      currency: asString(args.currency, 'EGP').toUpperCase(),
      description,
      personId: personId || null,
      projectId: projectId || null,
      ...(personName ? { personName } : {}),
      ...(projectName ? { projectName } : {}),
    };
    const candidates = approval.personCandidates ?? [];
    const projectCandidates = approval.projectCandidates ?? [];
    const validPerson = personMode !== 'new' || personName.trim().length > 0;
    const validProject = projectMode !== 'new' || projectName.trim().length > 0;

    return (
      <View style={styles.approvalFields}>
        <View style={styles.approvalField}>
          <Text style={[styles.approvalLabel, { color: colors.mutedForeground }]}>المبلغ</Text>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            style={[styles.approvalInput, { color: colors.foreground, borderColor: amountMinor ? colors.border : colors.destructive, backgroundColor: colors.background }]}
            placeholder="0.00"
            placeholderTextColor={colors.mutedForeground}
            testID={`approval-amount-${approval.operationId}`}
          />
        </View>
        <View style={styles.approvalField}>
          <Text style={[styles.approvalLabel, { color: colors.mutedForeground }]}>العملة</Text>
          <TextInput
            value={asString(args.currency, 'EGP')}
            onChangeText={(value) => updateArg('currency', value.toUpperCase())}
            style={[styles.approvalInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
            autoCapitalize="characters"
            testID={`approval-currency-${approval.operationId}`}
          />
        </View>
        <View style={styles.approvalField}>
          <Text style={[styles.approvalLabel, { color: colors.mutedForeground }]}>الوصف</Text>
          <TextInput
            value={description}
            onChangeText={(value) => updateArg('description', value)}
            style={[styles.approvalInput, { color: colors.foreground, borderColor: description.trim() ? colors.border : colors.destructive, backgroundColor: colors.background }]}
            placeholder="وصف المصروف"
            placeholderTextColor={colors.mutedForeground}
            testID={`approval-description-${approval.operationId}`}
          />
        </View>
        <View style={styles.approvalField}>
          <Text style={[styles.approvalLabel, { color: colors.mutedForeground }]}>الشخص</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.approvalCandidates}>
            <Pressable
              testID={`approval-person-none-${approval.operationId}`}
              onPress={() => selectUnlinked('person')}
              style={({ pressed }) => [styles.approvalCandidate, { borderColor: personMode === 'none' ? colors.primary : colors.border, backgroundColor: pressed ? colors.muted : colors.background }]}
            >
              <Text style={[styles.approvalCandidateText, { color: colors.foreground }]}>بدون شخص</Text>
            </Pressable>
            <Pressable
              testID={`approval-person-new-${approval.operationId}`}
              onPress={() => selectNew('person')}
              style={({ pressed }) => [styles.approvalCandidate, { borderColor: personMode === 'new' ? colors.primary : colors.border, backgroundColor: pressed ? colors.muted : colors.background }]}
            >
              <Text style={[styles.approvalCandidateText, { color: colors.foreground }]}>+ جديد</Text>
            </Pressable>
            {candidates.map((candidate) => (
                <Pressable
                  key={candidate.id}
                  onPress={() => selectCandidate(candidate, 'person')}
                  style={({ pressed }) => [styles.approvalCandidate, { borderColor: personMode === 'existing' && candidate.id === personId ? colors.primary : colors.border, backgroundColor: pressed ? colors.muted : colors.background }]}
                >
                  <Text style={[styles.approvalCandidateText, { color: colors.foreground }]}>{candidate.name}</Text>
                </Pressable>
            ))}
          </ScrollView>
          {personMode === 'new' && (
            <TextInput
              value={personName}
              onChangeText={(value) => {
                setPersonName(value);
                updateArg('personName', value);
              }}
              style={[styles.approvalInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              placeholder="اسم الشخص الجديد"
              placeholderTextColor={colors.mutedForeground}
              testID={`approval-person-${approval.operationId}`}
            />
          )}
        </View>
        <View style={styles.approvalField}>
          <Text style={[styles.approvalLabel, { color: colors.mutedForeground }]}>المشروع</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.approvalCandidates}>
            <Pressable
              testID={`approval-project-none-${approval.operationId}`}
              onPress={() => selectUnlinked('project')}
              style={({ pressed }) => [styles.approvalCandidate, { borderColor: projectMode === 'none' ? colors.primary : colors.border, backgroundColor: pressed ? colors.muted : colors.background }]}
            >
              <Text style={[styles.approvalCandidateText, { color: colors.foreground }]}>بدون مشروع</Text>
            </Pressable>
            <Pressable
              testID={`approval-project-new-${approval.operationId}`}
              onPress={() => selectNew('project')}
              style={({ pressed }) => [styles.approvalCandidate, { borderColor: projectMode === 'new' ? colors.primary : colors.border, backgroundColor: pressed ? colors.muted : colors.background }]}
            >
              <Text style={[styles.approvalCandidateText, { color: colors.foreground }]}>+ جديد</Text>
            </Pressable>
            {projectCandidates.map((candidate) => (
                <Pressable
                  key={candidate.id}
                  onPress={() => selectCandidate(candidate, 'project')}
                  style={({ pressed }) => [styles.approvalCandidate, { borderColor: projectMode === 'existing' && candidate.id === projectId ? colors.primary : colors.border, backgroundColor: pressed ? colors.muted : colors.background }]}
                >
                  <Text style={[styles.approvalCandidateText, { color: colors.foreground }]}>{candidate.name}</Text>
                </Pressable>
            ))}
          </ScrollView>
          {projectMode === 'new' && (
            <TextInput
              value={projectName}
              onChangeText={(value) => {
                setProjectName(value);
                updateArg('projectName', value);
              }}
              style={[styles.approvalInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              placeholder="اسم المشروع الجديد"
              placeholderTextColor={colors.mutedForeground}
              testID={`approval-project-${approval.operationId}`}
            />
          )}
        </View>
        <Pressable
          testID={`approval-edit-confirm-${approval.operationId}`}
          accessibilityRole="button"
          accessibilityLabel="اعتماد التعديلات"
          onPress={() => {
            if (amountMinor && description.trim() && validPerson && validProject) onApprove(approval, nextArgs);
          }}
          style={({ pressed }) => [styles.approveButton, { backgroundColor: colors.primary, opacity: pressed || !amountMinor || !description.trim() || !validPerson || !validProject ? 0.55 : 1 }]}
        >
          <Feather name="check" size={15} color={colors.primaryForeground} />
          <Text style={[styles.approveText, { color: colors.primaryForeground }]}>اعتماد التعديلات</Text>
        </Pressable>
      </View>
    );
  }

  if (toolName === 'create_reminder') {
    const text = asString(args.text);
    const dueAt = isoFromLocalDateTime(dueAtInput);
    const nextArgs = {
      ...args,
      text,
      dueAt,
      timezone: asString(args.timezone, 'Africa/Cairo'),
    };
    const validDueAt = Boolean(dueAt) && !Number.isNaN(new Date(dueAt).getTime());
    return (
      <View style={styles.approvalFields}>
        <View style={styles.approvalField}>
          <Text style={[styles.approvalLabel, { color: colors.mutedForeground }]}>التذكير</Text>
          <TextInput
            value={text}
            onChangeText={(value) => updateArg('text', value)}
            style={[styles.approvalInput, { color: colors.foreground, borderColor: text.trim() ? colors.border : colors.destructive, backgroundColor: colors.background }]}
            placeholder="نص التذكير"
            placeholderTextColor={colors.mutedForeground}
            testID={`approval-reminder-text-${approval.operationId}`}
          />
        </View>
        <View style={styles.approvalField}>
          <Text style={[styles.approvalLabel, { color: colors.mutedForeground }]}>الموعد</Text>
          <TextInput
            value={dueAtInput}
            onChangeText={(value) => {
              setDueAtInput(value);
              updateArg('dueAt', isoFromLocalDateTime(value));
            }}
            style={[styles.approvalInput, { color: colors.foreground, borderColor: validDueAt ? colors.border : colors.destructive, backgroundColor: colors.background }]}
            placeholder="YYYY-MM-DD HH:MM"
            placeholderTextColor={colors.mutedForeground}
            testID={`approval-reminder-due-at-${approval.operationId}`}
          />
        </View>
        <Pressable
          testID={`approval-edit-confirm-${approval.operationId}`}
          accessibilityRole="button"
          accessibilityLabel="اعتماد التعديلات"
          onPress={() => {
            if (text.trim() && validDueAt) onApprove(approval, nextArgs);
          }}
          style={({ pressed }) => [styles.approveButton, { backgroundColor: colors.primary, opacity: pressed || !text.trim() || !validDueAt ? 0.55 : 1 }]}
        >
          <Feather name="check" size={15} color={colors.primaryForeground} />
          <Text style={[styles.approveText, { color: colors.primaryForeground }]}>اعتماد التعديلات</Text>
        </Pressable>
      </View>
    );
  }

  return null;
}

export function MessageBubble({
  message,
  colors,
  onApprove,
  onReject,
  onOpenMain,
  onOpenRecord,
  busyOperationId,
  compact = false,
}: {
  message: LocalMessage;
  colors: ReturnType<typeof useColors>;
  onApprove: (approval: Approval, args?: ApprovalArgs) => void;
  onReject: (approval: Approval) => void;
  onOpenMain?: () => void;
  onOpenRecord: (record: MobileRecordRow) => void;
  busyOperationId: string | null;
  compact?: boolean;
}) {
  const isUser = message.role === 'user';
  const approvalBusy = message.approval && busyOperationId === message.approval.operationId;
  const isResolved = message.approval?.status === 'completed'
    || message.approval?.status === 'rejected'
    || message.approval?.status === 'expired'
    || message.approval?.status === 'failed';
  const canEdit = !compact && message.approval?.status === 'pending'
    && (message.approval.toolName === 'record_expense' || message.approval.toolName === 'create_reminder');
  const canQuickApprove = compact
    && message.approval?.status === 'pending'
    && message.approval.quickApprove === true;

  return (
    <View style={[styles.messageRow, isUser ? styles.userRow : styles.assistantRow]}>
      <View style={[styles.messageBubble, {
        backgroundColor: isUser ? colors.primary : colors.card,
        borderColor: isUser ? colors.primary : colors.border,
      }]}>
        <Text style={[styles.messageText, { color: isUser ? colors.primaryForeground : colors.foreground }]}>
          {message.text}
        </Text>
        <Text style={[styles.messageTime, { color: isUser ? colors.primaryForeground : colors.mutedForeground }]}>
          {messageTime(message.createdAt)}
        </Text>
        {message.approval && (
          <View style={[styles.approvalCard, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <View style={styles.approvalHeading}>
              <Feather name="shield" size={15} color={colors.primary} />
              <Text style={[styles.approvalTitle, { color: colors.foreground }]}>{message.approval.title}</Text>
            </View>
            {message.approval.details.map((detail) => (
              <Text key={detail} style={[styles.approvalDetail, { color: colors.mutedForeground }]}>{detail}</Text>
            ))}
            {isResolved ? (
              <View style={styles.resolvedRow}>
                <Feather
                  name={message.approval.status === 'completed' ? 'check-circle' : 'x-circle'}
                  size={15}
                  color={message.approval.status === 'completed' ? colors.primary : colors.destructive}
                />
                <Text style={[styles.resolvedText, { color: colors.mutedForeground }]}>
                  {message.approval.status === 'completed' ? 'تم التنفيذ' : 'تم الرفض'}
                </Text>
              </View>
            ) : (
              <>
              {canEdit && (
                <ApprovalEditor
                  approval={message.approval as Approval}
                  colors={colors}
                  onApprove={onApprove}
                />
              )}
              <View style={styles.approvalActions}>
                {canQuickApprove ? (
                  <Pressable
                    testID={`quick-approve-${message.approval.operationId}`}
                    accessibilityRole="button"
                    accessibilityLabel="اعتماد العملية سريعًا"
                    onPress={() => onApprove(message.approval as Approval)}
                    disabled={Boolean(approvalBusy)}
                    style={({ pressed }) => [styles.approveButton, { backgroundColor: colors.primary, opacity: pressed || approvalBusy ? 0.65 : 1 }]}
                  >
                    {approvalBusy ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Feather name="check" size={16} color={colors.primaryForeground} />}
                    <Text style={[styles.approveText, { color: colors.primaryForeground }]}>اعتماد</Text>
                  </Pressable>
                ) : !compact ? <Pressable
                  testID={`approve-${message.approval.operationId}`}
                  accessibilityRole="button"
                  accessibilityLabel="اعتماد العملية"
                   onPress={() => onApprove(message.approval as Approval)}
                  disabled={Boolean(approvalBusy)}
                  style={({ pressed }) => [styles.approveButton, { backgroundColor: colors.primary, opacity: pressed || approvalBusy ? 0.65 : 1 }]}
                >
                  {approvalBusy ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Feather name="check" size={16} color={colors.primaryForeground} />}
                  <Text style={[styles.approveText, { color: colors.primaryForeground }]}>اعتماد</Text>
                </Pressable> : null}
                {compact && !canQuickApprove && onOpenMain && (
                  <Pressable
                    testID={`open-main-review-${message.approval.operationId}`}
                    accessibilityRole="button"
                    accessibilityLabel="مراجعة العملية في البرنامج الرئيسي"
                    onPress={onOpenMain}
                    disabled={Boolean(approvalBusy)}
                    style={({ pressed }) => [styles.approveButton, { backgroundColor: colors.primary, opacity: pressed || approvalBusy ? 0.65 : 1 }]}
                  >
                    <Feather name="arrow-up-left" size={16} color={colors.primaryForeground} />
                    <Text style={[styles.approveText, { color: colors.primaryForeground }]}>مراجعة في Main</Text>
                  </Pressable>
                )}
                <Pressable
                  testID={`reject-${message.approval.operationId}`}
                  accessibilityRole="button"
                  accessibilityLabel="رفض العملية"
                  onPress={() => onReject(message.approval as Approval)}
                  disabled={Boolean(approvalBusy)}
                  style={({ pressed }) => [styles.rejectButton, { borderColor: colors.border, opacity: pressed || approvalBusy ? 0.65 : 1 }]}
                >
                  <Feather name="x" size={16} color={colors.mutedForeground} />
                  <Text style={[styles.rejectText, { color: colors.mutedForeground }]}>رفض</Text>
                </Pressable>
              </View>
              </>
            )}
          </View>
        )}
        {message.recordLink && (
          <Pressable
            testID={`open-record-${message.recordLink.recordType}-${message.recordLink.id}`}
            accessibilityRole="button"
            accessibilityLabel={`فتح تفاصيل ${message.recordLink.title}`}
            onPress={() => onOpenRecord(message.recordLink as MobileRecordRow)}
            style={({ pressed }) => [styles.messageLink, { borderColor: colors.border, opacity: pressed ? 0.65 : 1 }]}
          >
            <Feather name="arrow-up-left" size={15} color={colors.primary} />
            <Text style={[styles.messageLinkText, { color: colors.primary }]}>فتح التفاصيل</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}