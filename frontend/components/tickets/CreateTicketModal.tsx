'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Wrench,
  PackagePlus,
  TrendingUp,
  MessageSquare,
  ClipboardCheck,
  ArrowLeft,
} from 'lucide-react';
import { api, getErrorMessage } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

// -----------------------------------------------------------------------
// 요청 유형 정의
// -----------------------------------------------------------------------
type RequestType =
  | 'incident'
  | 'service_request'
  | 'installation'
  | 'upgrade'
  | 'technical_inquiry'
  | 'maintenance';

const REQUEST_TYPES: {
  id: RequestType;
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
}[] = [
  {
    id: 'incident',
    label: '장애 지원',
    description: '시스템 장애·오류 처리',
    icon: AlertTriangle,
    color: 'text-error',
  },
  {
    id: 'installation',
    label: '설치/구축',
    description: '신규 장비·소프트웨어 설치',
    icon: PackagePlus,
    color: 'text-info-text',
  },
  {
    id: 'upgrade',
    label: '업그레이드',
    description: '버전 업그레이드·마이그레이션',
    icon: TrendingUp,
    color: 'text-warning-text',
  },
  {
    id: 'service_request',
    label: '서비스 요청',
    description: '계정·권한·설정 변경 등',
    icon: Wrench,
    color: 'text-success-text',
  },
  {
    id: 'technical_inquiry',
    label: '기술 문의',
    description: '기술 질문·컨설팅',
    icon: MessageSquare,
    color: 'text-text-secondary',
  },
  {
    id: 'maintenance',
    label: '정기 유지보수',
    description: '예약된 점검·유지보수',
    icon: ClipboardCheck,
    color: 'text-text-secondary',
  },
];

// -----------------------------------------------------------------------
// Zod 스키마
// -----------------------------------------------------------------------
const createTicketSchema = z.object({
  title: z.string().min(1, '제목을 입력해주세요.').max(500),
  description: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  channel: z.enum(['email', 'phone', 'portal', 'internal']),
  source: z.string().optional(),
});

type CreateTicketValues = z.infer<typeof createTicketSchema>;

// -----------------------------------------------------------------------
// 인라인 폼 필드 래퍼
// -----------------------------------------------------------------------
function FormField({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-text-primary">
        {label}
        {required && <span className="ml-0.5 text-error">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-error-text">{error}</p>}
    </div>
  );
}

// -----------------------------------------------------------------------
// Step 1: 요청 유형 카드 선택
// -----------------------------------------------------------------------
function RequestTypeStep({
  onSelect,
}: {
  onSelect: (type: RequestType) => void;
}) {
  return (
    <div className="px-6 pb-2">
      <p className="text-sm text-text-secondary mb-4">어떤 유형의 지원이 필요하신가요?</p>
      <div className="grid grid-cols-3 gap-3">
        {REQUEST_TYPES.map(({ id, label, description, icon: Icon, color }) => (
          <button
            key={id}
            onClick={() => onSelect(id)}
            className="flex flex-col items-start gap-2 rounded-lg border border-border-default bg-surface p-3 text-left transition-colors hover:border-border-strong hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-border-strong"
          >
            <Icon size={18} className={color} />
            <div>
              <p className="text-sm font-medium text-text-primary">{label}</p>
              <p className="text-xs text-text-secondary mt-0.5">{description}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Step 2: 유형별 폼
// -----------------------------------------------------------------------
function TicketFormStep({
  requestType,
  tenantSlug,
  onSuccess,
  onBack,
}: {
  requestType: RequestType;
  tenantSlug: string;
  onSuccess: () => void;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const typeInfo = REQUEST_TYPES.find((t) => t.id === requestType)!;
  const Icon = typeInfo.icon;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateTicketValues>({
    resolver: zodResolver(createTicketSchema),
    defaultValues: {
      priority: requestType === 'incident' ? 'high' : 'medium',
      channel: 'internal',
    },
  });

  const priority = watch('priority');
  const channel = watch('channel');
  const source = watch('source');

  async function onSubmit(values: CreateTicketValues) {
    try {
      await api.post(`/${tenantSlug}/tickets`, {
        ...values,
        request_type: requestType,
      });
      toast.success('티켓이 생성되었습니다.');
      await queryClient.invalidateQueries({ queryKey: ['tickets', tenantSlug] });
      onSuccess();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }

  return (
    <>
      <div className="px-6 pb-0">
        {/* 유형 표시 */}
        <div className="flex items-center gap-2 mb-4 rounded-lg bg-surface-raised px-3 py-2">
          <Icon size={15} className={typeInfo.color} />
          <span className="text-sm font-medium text-text-primary">{typeInfo.label}</span>
        </div>

        <div className="flex flex-col gap-4">
          {/* 제목 */}
          <FormField label="제목" required error={errors.title?.message}>
            <input
              {...register('title')}
              placeholder="티켓 제목을 입력하세요"
              autoFocus
              className="h-9 w-full rounded-md border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
            />
          </FormField>

          {/* 설명 */}
          <FormField label="설명" error={errors.description?.message}>
            <textarea
              {...register('description')}
              rows={3}
              placeholder={
                requestType === 'incident'
                  ? '증상, 발생 시각, 영향 범위를 입력하세요'
                  : '요청 내용을 자세히 설명해주세요'
              }
              className="w-full rounded-md border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-disabled resize-none focus:outline-none focus:ring-2 focus:ring-border-strong"
            />
          </FormField>

          {/* 우선순위 + 채널 */}
          <div className="grid grid-cols-2 gap-3">
            <FormField label="우선순위" required error={errors.priority?.message}>
              <Select
                value={priority}
                onValueChange={(v) => setValue('priority', v as CreateTicketValues['priority'])}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">낮음</SelectItem>
                  <SelectItem value="medium">보통</SelectItem>
                  <SelectItem value="high">높음</SelectItem>
                  <SelectItem value="critical">긴급</SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            <FormField label="접수 채널">
              <Select
                value={channel}
                onValueChange={(v) => setValue('channel', v as CreateTicketValues['channel'])}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">이메일</SelectItem>
                  <SelectItem value="phone">전화</SelectItem>
                  <SelectItem value="portal">포털</SelectItem>
                  <SelectItem value="internal">내부</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          </div>

          {/* 발견 주체 (incident 전용) */}
          {requestType === 'incident' && (
            <FormField label="발견 주체">
              <Select
                value={source ?? ''}
                onValueChange={(v) => setValue('source', v)}
              >
                <SelectTrigger><SelectValue placeholder="선택 (선택)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="customer_direct">고객 직접 신고</SelectItem>
                  <SelectItem value="customer_relay">고객사 내부 전달</SelectItem>
                  <SelectItem value="engineer_found">엔지니어 발견</SelectItem>
                  <SelectItem value="monitoring">모니터링 감지</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          )}
        </div>
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onBack} leftIcon={<ArrowLeft size={13} />}>
          유형 변경
        </Button>
        <Button onClick={handleSubmit(onSubmit)} isLoading={isSubmitting}>
          생성
        </Button>
      </DialogFooter>
    </>
  );
}

// -----------------------------------------------------------------------
// Props
// -----------------------------------------------------------------------
interface CreateTicketModalProps {
  open: boolean;
  onClose: () => void;
  tenantSlug: string;
}

export function CreateTicketModal({ open, onClose, tenantSlug }: CreateTicketModalProps) {
  const [selectedType, setSelectedType] = React.useState<RequestType | null>(null);

  function handleClose() {
    setSelectedType(null);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className={cn('max-w-lg', !selectedType && 'max-w-xl')}>
        <DialogHeader>
          <DialogTitle>
            {selectedType ? '새 티켓 생성' : '요청 유형 선택'}
          </DialogTitle>
        </DialogHeader>

        {selectedType ? (
          <TicketFormStep
            requestType={selectedType}
            tenantSlug={tenantSlug}
            onSuccess={handleClose}
            onBack={() => setSelectedType(null)}
          />
        ) : (
          <>
            <RequestTypeStep onSelect={setSelectedType} />
            <DialogFooter>
              <Button variant="ghost" onClick={handleClose}>취소</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
