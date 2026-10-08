import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useEffect, useState } from 'react';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/hooks/useLanguage';
import { approvalExplanation } from '../services/operation-presentation';
import { localized, type Approval, type ApprovalArgs, type ApprovalCandidate, type LocalMessage, type MobileRecordRow } from './shared';
import { OperationStatusNotice } from './OperationStatusNotice';
import { ApprovalStatusGate } from './ApprovalStatusGate';
import { LocalInputAttachmentView } from './local-input-attachment';
import { styles, starterMessage } from './shared';

const APPROVAL_DRAFT_PREFIX = '@personal-secretary-mobile/approval-draft/';
const APPROVAL_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

function approvalDraftKey(operationId: string) {
  return `${APPROVAL_DRAFT_PREFIX}${operationId}`;
}

function clearApprovalDraft(operationId: string) {
  void AsyncStorage.removeItem(approvalDraftKey(operationId)).catch(() => undefined);
}

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
  const [draftReady, setDraftReady] = useState(false);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(approvalDraftKey(approval.operationId))
      .then((raw) => {
        if (!active || !raw) return;
        try {
          const parsed = JSON.parse(raw) as { savedAt?: unknown; args?: unknown };
          const savedAt = typeof parsed.savedAt === 'number' ? parsed.savedAt : 0;
          const draft = parsed.args && typeof parsed.args === 'object' && !Array.isArray(parsed.args)
            ? parsed.args as ApprovalArgs
            : null;
          if (!draft || Date.now() - savedAt >= APPROVAL_DRAFT_TTL_MS) {
            if (savedAt > 0 && Date.now() - savedAt >= APPROVAL_DRAFT_TTL_MS) {
              clearApprovalDraft(approval.operationId);
            }
            return;
          }
          setArgs(draft);
          setAmount(amountInputFromArgs(draft));
          setPersonName(asString(draft.personName));
          setProjectName(asString(draft.projectName));
          setPersonId(asString(draft.personId));
          setProjectId(asString(draft.projectId));
          setPersonMode(asString(draft.personId) ? 'existing' : asString(draft.personName) ? 'new' : 'none');
          setProjectMode(asString(draft.projectId) ? 'existing' : asString(draft.projectName) ? 'new' : 'none');
          setDueAtInput(localDateTimeValue(asString(draft.dueAt)));
        } catch {
          // Invalid local drafts are ignored; the server operation remains authoritative.
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setDraftReady(true);
      });
    return () => {
      active = false;
    };
  }, [approval.operationId]);

  useEffect(() => {
    if (!draftReady || approval.status !== 'pending') return;
    const draft: ApprovalArgs = toolName === 'record_expense'
      ? {
        ...args,
        amountMinor: parseAmountMinor(amount) ?? asNumber(args.amountMinor),
        personId: personId || null,
        projectId: projectId || null,
        ...(personName ? { personName } : {}),
        ...(projectName ? { projectName } : {}),
      }
      : toolName === 'create_reminder'
        ? {
          ...args,
          text: asString(args.text),
          dueAt: isoFromLocalDateTime(dueAtInput),
          timezone: asString(args.timezone, 'Africa/Cairo'),
        }
        : args;
    void AsyncStorage.setItem(approvalDraftKey(approval.operationId), JSON.stringify({
      savedAt: Date.now(),
      args: draft,
    })).catch(() => undefined);
  }, [
    approval.operationId,
    approval.status,
    args,
    amount,
    draftReady,
    dueAtInput,
    personId,
    personName,
    projectId,
    projectName,
    toolName,
  ]);

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
            if (amountMinor && description.trim() && validPerson && validProject) {
              clearApprovalDraft(approval.operationId);
              onApprove(approval, nextArgs);
            }
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
            if (text.trim() && validDueAt) {
              clearApprovalDraft(approval.operationId);
              onApprove(approval, nextArgs);
            }
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
  onRetryInput,
  retryingInput = false,
  busyOperationId,
  compact = false,
  pearlStyle = false,
}: {
  message: LocalMessage;
  colors: ReturnType<typeof useColors>;
  onApprove: (approval: Approval, args?: ApprovalArgs) => void;
  onReject: (approval: Approval) => void;
  onOpenMain?: () => void;
  onOpenRecord: (record: MobileRecordRow) => void;
  onRetryInput?: (attachment: LocalMessage['inputAttachment']) => void;
  retryingInput?: boolean;
  busyOperationId: string | null;
  compact?: boolean;
  pearlStyle?: boolean;
}) {
  const { language } = useLanguage();
  const isUser = message.role === 'user';
  const approvals = message.approvals ?? (message.approval ? [message.approval] : []);

  return (
    <View style={[styles.messageRow, isUser ? styles.userRow : styles.assistantRow]}>
      <View style={[
        styles.messageBubble,
        pearlStyle && styles.pearlMessageBubble,
        pearlStyle && (isUser ? styles.pearlUserMessageBubble : styles.pearlAssistantMessageBubble),
        {
          backgroundColor: isUser ? (pearlStyle ? colors.muted : colors.primary) : colors.card,
          borderColor: colors.border,
        },
      ]}>
        <Text style={[styles.messageText, pearlStyle && styles.pearlMessageText, { color: isUser && !pearlStyle ? colors.primaryForeground : colors.foreground }]}>
          {message.text}
        </Text>
        {message.inputAttachment && (
          <LocalInputAttachmentView
            attachment={message.inputAttachment}
            onRetry={onRetryInput ? () => onRetryInput(message.inputAttachment) : undefined}
            retrying={retryingInput}
          />
        )}
        {!pearlStyle && (
          <Text style={[styles.messageTime, { color: isUser ? colors.primaryForeground : colors.mutedForeground }]}>
            {messageTime(message.createdAt)}
          </Text>
        )}
        {approvals.map((snapshotApproval) => (
          <ApprovalStatusGate
            key={snapshotApproval.operationId}
            approval={snapshotApproval}
            operationNotice={
              !message.operationNotice?.operationId
                || message.operationNotice.operationId === snapshotApproval.operationId
                ? message.operationNotice
                : undefined
            }
            colors={colors}
            language={language}
          >
          {({ approval, canRespond }) => {
          const approvalBusy = busyOperationId === approval.operationId;
          const noticeStatus = message.operationNotice?.operationId
            && message.operationNotice.operationId !== approval.operationId
            ? undefined
            : message.operationNotice?.status;
          const unknownOutcome = noticeStatus === 'unknown_result';
          const needsReview = noticeStatus === 'needs_review';
          const isExecuting = approval.status === 'executing'
            || noticeStatus === 'executing'
            || noticeStatus === 'verifying';
          const isWaiting = noticeStatus === 'waiting';
          const isResolved = ['completed', 'rejected', 'expired', 'failed'].includes(approval.status)
            || ['completed', 'rejected', 'expired', 'failed', 'unknown_result', 'needs_review', 'cancelled'].includes(noticeStatus ?? '')
            || isWaiting
            || isExecuting;
          const operationCompleted = approval.status === 'completed' || noticeStatus === 'completed';
          const operationRejected = approval.status === 'rejected' || noticeStatus === 'rejected';
          const operationExpired = approval.status === 'expired' || noticeStatus === 'expired';
          const operationFailed = approval.status === 'failed' || noticeStatus === 'failed';
          const operationCancelled = noticeStatus === 'cancelled';
          const canShowPending = approval.status === 'pending'
            && (!noticeStatus || noticeStatus === 'pending_approval');
          const canEdit = canRespond && !compact && approval.status === 'pending'
            && (approval.toolName === 'record_expense' || approval.toolName === 'create_reminder');
          const canQuickApprove = canRespond && compact && approval.status === 'pending' && approval.quickApprove === true;
          const explanation = approvalExplanation(approval.toolName, language);
          return (
          <View key={approval.operationId} style={[styles.approvalCard, pearlStyle && styles.pearlApprovalCard, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <View style={[styles.approvalHeading, pearlStyle && styles.pearlApprovalHeading]}>
              <Feather name="shield" size={15} color={colors.primary} />
              <Text style={[styles.approvalTitle, pearlStyle && styles.pearlApprovalTitle, { color: colors.foreground }]}>{approval.title}</Text>
            </View>
            {approval.details.map((detail) => (
              <Text key={detail} style={[styles.approvalDetail, pearlStyle && styles.pearlApprovalDetail, { color: colors.mutedForeground }]}>{detail}</Text>
            ))}
            {canShowPending && (
              <View style={{ marginTop: 8, paddingTop: 7, borderTopWidth: 1, borderTopColor: colors.border }}>
                <Text style={[styles.approvalDetail, { color: colors.foreground, fontWeight: '700' }]}>
                  {localized(language, 'محتاج موافقتك', 'Waiting for your approval')}
                </Text>
                <Text style={[styles.approvalDetail, { color: colors.mutedForeground }]}>
                  {localized(language, `الجهة: ${explanation.service}`, `Service: ${explanation.service}`)}
                </Text>
                <Text style={[styles.approvalDetail, { color: colors.mutedForeground }]}>{explanation.reason}</Text>
                <Text style={[styles.approvalDetail, { color: colors.mutedForeground }]}>{explanation.afterApproval}</Text>
              </View>
            )}
            {isResolved || isExecuting ? (
              noticeStatus ? null : (
                <View style={styles.resolvedRow}>
                  <Feather
                    name={operationCompleted ? 'check-circle' : isExecuting ? 'loader' : operationRejected ? 'x-circle' : 'alert-circle'}
                    size={15}
                    color={operationCompleted ? colors.primary : isExecuting || unknownOutcome || needsReview ? colors.accent : operationRejected ? colors.destructive : colors.mutedForeground}
                  />
                  <Text style={[styles.resolvedText, { color: colors.mutedForeground }]}>
                    {unknownOutcome
                      ? localized(language, 'نتيجة التنفيذ غير مؤكدة', 'Outcome unconfirmed')
                      : needsReview
                        ? localized(language, 'يحتاج إلى مراجعتك', 'Needs your review')
                        : operationCompleted
                      ? localized(language, 'تم التنفيذ', 'Completed')
                      : operationRejected
                        ? localized(language, 'تم الرفض', 'Rejected')
                        : operationExpired
                          ? localized(language, 'انتهت صلاحية الموافقة', 'Approval expired')
                          : operationFailed
                            ? localized(language, 'التنفيذ فشل', 'Execution failed')
                            : operationCancelled
                              ? localized(language, 'تم إلغاء العملية', 'Operation cancelled')
                              : isWaiting
                                ? localized(language, 'في انتظار الخطوة التالية', 'Waiting for the next step')
                                : noticeStatus === 'verifying'
                                  ? localized(language, 'جارٍ التحقق', 'Verifying')
                                  : localized(language, 'جارٍ التنفيذ', 'Executing')}
                  </Text>
                </View>
              )
            ) : (
              <>
              {canEdit && (
                <ApprovalEditor
                  approval={approval}
                  colors={colors}
                  onApprove={(nextApproval, args) => {
                    clearApprovalDraft(nextApproval.operationId);
                    onApprove(nextApproval, args);
                  }}
                />
              )}
              <View style={[styles.approvalActions, pearlStyle && styles.pearlApprovalActions]}>
                {canQuickApprove ? (
                  <Pressable
                     testID={`quick-approve-${approval.operationId}`}
                    accessibilityRole="button"
                    accessibilityLabel="الموافقة على العملية سريعًا"
                     onPress={() => {
                       clearApprovalDraft(approval.operationId);
                       onApprove(approval);
                     }}
                    disabled={Boolean(approvalBusy) || !canRespond}
                   style={({ pressed }) => [styles.approveButton, pearlStyle && styles.pearlApproveButton, { backgroundColor: colors.primary, opacity: pressed || approvalBusy ? 0.65 : 1 }]}
                  >
                    {approvalBusy ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Feather name="check" size={16} color={colors.primaryForeground} />}
                   <Text style={[styles.approveText, pearlStyle && styles.pearlApproveText, { color: colors.primaryForeground }]}>موافقة</Text>
                  </Pressable>
                ) : !compact ? <Pressable
                   testID={`approve-${approval.operationId}`}
                  accessibilityRole="button"
                   accessibilityLabel="الموافقة على العملية"
                     onPress={() => {
                       clearApprovalDraft(approval.operationId);
                       onApprove(approval);
                     }}
                   disabled={Boolean(approvalBusy) || !canRespond}
                   style={({ pressed }) => [styles.approveButton, pearlStyle && styles.pearlApproveButton, { backgroundColor: colors.primary, opacity: pressed || approvalBusy ? 0.65 : 1 }]}
                >
                  {approvalBusy ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Feather name="check" size={16} color={colors.primaryForeground} />}
                   <Text style={[styles.approveText, pearlStyle && styles.pearlApproveText, { color: colors.primaryForeground }]}>موافقة</Text>
                </Pressable> : null}
                {compact && !canQuickApprove && onOpenMain && (
                  <Pressable
                     testID={`open-main-review-${approval.operationId}`}
                    accessibilityRole="button"
                    accessibilityLabel="مراجعة العملية في البرنامج الرئيسي"
                    onPress={onOpenMain}
                   disabled={Boolean(approvalBusy) || !canRespond}
                    style={({ pressed }) => [styles.approveButton, { backgroundColor: colors.primary, opacity: pressed || approvalBusy ? 0.65 : 1 }]}
                  >
                    <Feather name="arrow-up-left" size={16} color={colors.primaryForeground} />
                    <Text style={[styles.approveText, { color: colors.primaryForeground }]}>مراجعة في Main</Text>
                  </Pressable>
                )}
                <Pressable
                   testID={`reject-${approval.operationId}`}
                  accessibilityRole="button"
                  accessibilityLabel="رفض العملية"
                    onPress={() => {
                      clearApprovalDraft(approval.operationId);
                      onReject(approval);
                    }}
                  disabled={Boolean(approvalBusy)}
                   style={({ pressed }) => [styles.rejectButton, pearlStyle && styles.pearlRejectButton, { borderColor: colors.border, opacity: pressed || approvalBusy ? 0.65 : 1 }]}
                >
                  <Feather name="x" size={16} color={colors.mutedForeground} />
                  <Text style={[styles.rejectText, pearlStyle && styles.pearlRejectText, { color: colors.mutedForeground }]}>رفض</Text>
                </Pressable>
              </View>
              </>
            )}
          </View>
          );
          }}
          </ApprovalStatusGate>
        ))}
        {message.operationNotice && !(message.operationNotice.status === 'pending_approval' && approvals.length > 0) && (
          <OperationStatusNotice notice={message.operationNotice} colors={colors} language={language} />
        )}
        {message.recordLink && (
          <Pressable
            testID={`open-record-${message.recordLink.recordType}-${message.recordLink.id}`}
            accessibilityRole="button"
            accessibilityLabel={`فتح تفاصيل ${message.recordLink.title}`}
            onPress={() => onOpenRecord(message.recordLink as MobileRecordRow)}
            style={({ pressed }) => [styles.messageLink, { borderColor: colors.border, opacity: pressed ? 0.65 : 1 }]}
          >
            <Feather name="file-text" size={14} color={colors.primary} />
            <Text style={[styles.messageLinkText, { color: colors.primary }]}>فتح السجل المصدر</Text>
          </Pressable>
        )}
      </View>
      {pearlStyle && (
        <Text style={[styles.messageTime, styles.pearlMessageTime, isUser && styles.pearlUserMessageTime, { color: colors.mutedForeground }]}>
          {messageTime(message.createdAt)}
        </Text>
      )}
    </View>
  );
}