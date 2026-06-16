'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Wrench,
  PackagePlus,
  TrendingUp,
  MessageSquare,
  ClipboardCheck,
  ArrowLeft,
  X,
} from 'lucide-react';
import { api, getErrorMessage } from '@/lib/api';
import type { KnownIssue, SymptomCategory, Customer, Contract, ContractTier } from '@/lib/types';
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
  symptom_category_id: z.string().optional(),
  customer_id: z.string().optional(),
  contract_id: z.string().optional(),
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
// SLA 등급 뱃지 색상
// -----------------------------------------------------------------------
const SLA_GRADE_CONFIG: Record<string, { label: string; cls: string; desc: string }> = {
  bronze:   { label: 'Bronze',   cls: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300', desc: '응답 8시간 이내' },
  silver:   { label: 'Silver',   cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',       desc: '응답 4시간 이내' },
  gold:     { label: 'Gold',     cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',   desc: '응답 2시간 이내' },
  platinum: { label: 'Platinum', cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400', desc: '응답 1시간 이내' },
};

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

  // 고객/계약 상태 (Zod 폼 외부 관리 — 검색 UI가 복잡)
  const [customerQuery, setCustomerQuery] = React.useState('');
  const [selectedCustomer, setSelectedCustomer] = React.useState<Customer | null>(null);
  const [selectedContractId, setSelectedContractId] = React.useState<string>('');
  const [customerDropdownOpen, setCustomerDropdownOpen] = React.useState(false);
  const searchTimerRef = React.useRef<ReturnType<typeof setTimeout>>();
  const [debouncedQuery, setDebouncedQuery] = React.useState('');

  // 고객 검색 debounce
  React.useEffect(() => {
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedQuery(customerQuery);
    }, 300);
    return () => clearTimeout(searchTimerRef.current);
  }, [customerQuery]);

  // 고객 검색 쿼리
  const { data: customerSearchData } = useQuery<{ items: Customer[] }>({
    queryKey: ['customer-search', tenantSlug, debouncedQuery],
    queryFn: () =>
      api
        .get(`/${tenantSlug}/customers`, { params: { search: debouncedQuery, page_size: 10 } })
        .then((r) => r.data),
    enabled: debouncedQuery.length > 0 && !selectedCustomer,
    staleTime: 30 * 1000,
  });

  const customerResults: Customer[] = customerSearchData?.items ?? [];

  // 계약 목록 (고객 선택 후 활성화)
  const { data: contractsData } = useQuery<{ items: Contract[] }>({
    queryKey: ['contracts-for-ticket', tenantSlug, selectedCustomer?.id],
    queryFn: () =>
      api
        .get(`/${tenantSlug}/contracts`, {
          params: { customer_id: selectedCustomer!.id, page_size: 20 },
        })
        .then((r) => r.data),
    enabled: !!selectedCustomer,
    staleTime: 60 * 1000,
  });

  const contracts: Contract[] = contractsData?.items ?? [];

  // 선택된 계약
  const selectedContract = contracts.find((c) => c.id === selectedContractId) ?? null;

  // 연결된 SA 사업카드 이름 (고객에 linked_business_id 있을 때)
  const { data: businessesData } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['businesses', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/businesses`).then((r) => r.data),
    enabled: !!selectedCustomer?.linked_business_id,
    staleTime: 5 * 60 * 1000,
  });
  const linkedBusinessName = selectedCustomer?.linked_business_id
    ? (businessesData ?? []).find((b) => b.id === selectedCustomer.linked_business_id)?.name
    : null;

  // 고객 선택 시 계약 초기화
  function handleSelectCustomer(customer: Customer) {
    setSelectedCustomer(customer);
    setCustomerQuery(customer.company ? `${customer.name} (${customer.company})` : customer.name);
    setCustomerDropdownOpen(false);
    setSelectedContractId('');
  }

  // 고객 선택 해제
  function handleClearCustomer() {
    setSelectedCustomer(null);
    setCustomerQuery('');
    setSelectedContractId('');
    setCustomerDropdownOpen(false);
  }

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
  const symptomCategoryId = watch('symptom_category_id');

  // 증상 분류 목록 (incident 전용)
  const { data: symptomCategoriesData } = useQuery<{ items: SymptomCategory[] } | SymptomCategory[]>({
    queryKey: ['symptom-categories', tenantSlug],
    queryFn: () =>
      api.get(`/${tenantSlug}/symptom-categories`).then((r) => r.data),
    enabled: requestType === 'incident',
    staleTime: 5 * 60 * 1000,
  });

  const symptomCategories: SymptomCategory[] = Array.isArray(symptomCategoriesData)
    ? symptomCategoriesData
    : Array.isArray((symptomCategoriesData as { items: SymptomCategory[] })?.items)
      ? (symptomCategoriesData as { items: SymptomCategory[] }).items
      : [];

  // 알려진 이슈 제안 (symptom_category_id 선택 시)
  const { data: knownIssuesData } = useQuery<{ items: KnownIssue[] } | KnownIssue[]>({
    queryKey: ['known-issues-suggest', tenantSlug, symptomCategoryId],
    queryFn: () =>
      api
        .get(`/${tenantSlug}/kb/known-issues/suggest`, {
          params: { symptom_category_id: symptomCategoryId },
        })
        .then((r) => r.data),
    enabled: requestType === 'incident' && !!symptomCategoryId,
    staleTime: 60 * 1000,
  });

  const knownIssues: KnownIssue[] = Array.isArray(knownIssuesData)
    ? knownIssuesData
    : Array.isArray((knownIssuesData as { items: KnownIssue[] })?.items)
      ? (knownIssuesData as { items: KnownIssue[] }).items
      : [];

  async function onSubmit(values: CreateTicketValues) {
    try {
      await api.post(`/${tenantSlug}/tickets`, {
        ...values,
        request_type: requestType,
        customer_id: selectedCustomer?.id || undefined,
        contract_id: selectedContractId || undefined,
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
          {/* 고객 선택 */}
          <FormField label="고객">
            <div className="relative">
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={customerQuery}
                  onChange={(e) => {
                    setCustomerQuery(e.target.value);
                    if (!selectedCustomer) setCustomerDropdownOpen(true);
                    else setSelectedCustomer(null);
                  }}
                  onFocus={() => {
                    if (!selectedCustomer && customerQuery.length > 0) setCustomerDropdownOpen(true);
                  }}
                  placeholder="고객명 검색..."
                  readOnly={!!selectedCustomer}
                  className="h-9 w-full rounded-md border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
                />
                {selectedCustomer && (
                  <button
                    type="button"
                    onClick={handleClearCustomer}
                    className="shrink-0 rounded p-1.5 text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
                    aria-label="고객 선택 해제"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              {/* 검색 결과 드롭다운 */}
              {customerDropdownOpen && customerResults.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full rounded-md border border-border-default bg-surface shadow-lg max-h-48 overflow-y-auto">
                  {customerResults.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => handleSelectCustomer(c)}
                        className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-surface-hover transition-colors"
                      >
                        {c.name}
                        {c.company && (
                          <span className="ml-1 text-text-secondary">({c.company})</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </FormField>

          {/* 계약 선택 */}
          <FormField label="계약">
            <Select
              value={selectedContractId}
              onValueChange={setSelectedContractId}
              disabled={!selectedCustomer}
            >
              <SelectTrigger>
                <SelectValue placeholder={selectedCustomer ? '계약 선택...' : '고객을 먼저 선택하세요'} />
              </SelectTrigger>
              <SelectContent>
                {contracts.map((contract) => (
                  <SelectItem key={contract.id} value={contract.id}>
                    {contract.name} (SLA: {contract.sla_grade})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* SLA 등급 뱃지 */}
            {selectedContract && (() => {
              const grade = selectedContract.sla_grade.toLowerCase();
              const cfg = SLA_GRADE_CONFIG[grade] ?? {
                label: selectedContract.sla_grade,
                cls: 'bg-neutral-100 text-neutral-600',
                desc: '',
              };
              return (
                <div className="flex items-center gap-2 mt-1.5">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cfg.cls}`}>
                    SLA {cfg.label}
                  </span>
                  {cfg.desc && (
                    <span className="text-xs text-text-secondary">{cfg.desc}</span>
                  )}
                </div>
              );
            })()}
          </FormField>

          {/* 연결된 SA 사업카드 표시 (고객 선택 시) */}
          {selectedCustomer && (
            <div className="flex items-center gap-2 rounded-md bg-surface-raised px-3 py-2 text-xs">
              <span className="text-text-secondary">SA 사업카드:</span>
              {linkedBusinessName
                ? <span className="font-medium text-text-primary">{linkedBusinessName}</span>
                : selectedCustomer.linked_business_id
                  ? <span className="text-text-secondary">로딩 중...</span>
                  : <span className="text-text-disabled">미연결 — 고객 정보에서 사업카드를 연결하세요</span>
              }
            </div>
          )}

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

          {/* 증상 분류 + 발견 주체 (incident 전용) */}
          {requestType === 'incident' && (
            <>
              <FormField label="증상 분류">
                <Select
                  value={symptomCategoryId ?? ''}
                  onValueChange={(v) => setValue('symptom_category_id', v || undefined)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="선택 (선택)" />
                  </SelectTrigger>
                  <SelectContent>
                    {symptomCategories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              {/* 알려진 이슈 배너 */}
              {knownIssues.length > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-warning bg-warning-bg px-3 py-2.5 text-sm text-warning-text">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>
                    알려진 이슈 {knownIssues.length}건 —{' '}
                    {knownIssues.map((ki) => ki.title).join(', ')}.
                    해결 방법을 먼저 확인해보세요.
                  </span>
                </div>
              )}

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
            </>
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
