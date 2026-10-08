import { useGetSecretaryOperation, getGetSecretaryOperationQueryKey } from '@workspace/api-client-react';
import { ActivityIndicator, Text, View } from 'react-native';
import type { ReactNode } from 'react';
import type { useColors } from '@/hooks/useColors';
import type { AppLanguage } from '@/hooks/useLanguage';
import { secretaryFailureText } from '../services/operation-presentation';
import type { Approval, OperationNotice } from './shared';

export function ApprovalStatusGate({
  approval,
  operationNotice,
  colors,
  language,
  children,
}: {
  approval: Approval;
  operationNotice?: OperationNotice;
  colors: ReturnType<typeof useColors>;
  language: AppLanguage;
    children: (state: {
    approval: Approval;
    canRespond: boolean;
    loading: boolean;
    queryError?: string;
  }) => ReactNode;
}) {
  const blocksAction = Boolean(operationNotice && operationNotice.status !== 'pending_approval');
  const shouldCheck = ['pending', 'executing'].includes(approval.status) && !blocksAction;
  const operationQuery = useGetSecretaryOperation(approval.operationId, {
    query: {
      queryKey: getGetSecretaryOperationQueryKey(approval.operationId),
      enabled: shouldCheck,
      staleTime: 0,
      refetchInterval: (query) => query.state.data?.status === 'executing' && !blocksAction ? 2_000 : false,
    },
  });
  const currentStatus = operationQuery.data?.status ?? approval.status;
  const currentApproval: Approval = {
    ...approval,
    status: currentStatus,
  };
  const canRespond = Boolean(
    operationQuery.data
    && currentStatus === 'pending'
    && !operationQuery.isError
    && !operationQuery.isFetching
    && !blocksAction,
  );
  const queryError = operationQuery.isError
    ? secretaryFailureText(operationQuery.error, language)
    : undefined;

  return (
    <View>
      {shouldCheck && operationQuery.isPending && (
        <View accessibilityLiveRegion="polite" style={{ flexDirection: language === 'en' ? 'row' : 'row-reverse', alignItems: 'center', gap: 7, marginTop: 8 }}>
          <ActivityIndicator size="small" color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
            {language === 'en' ? 'Checking the current approval status…' : 'جارٍ التحقق من حالة الموافقة…'}
          </Text>
        </View>
      )}
      {queryError && (
        <Text accessibilityRole="alert" style={{ color: colors.destructive, fontSize: 12, marginTop: 8 }}>
          {queryError}
        </Text>
      )}
      {children({
        approval: currentApproval,
        canRespond,
        loading: shouldCheck && operationQuery.isFetching,
        ...(queryError ? { queryError } : {}),
      })}
    </View>
  );
}
