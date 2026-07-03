const ko = {
  nav: {
    dashboard: '대시보드',
    tickets: '티켓',
    workLogs: '작업 시간',
    customers: '고객',
    kb: '지식베이스',
    recurringIssues: '반복 이슈',
    reports: '리포트',
    settings: '설정',
    assets: '자산',
    cmdb: 'CMDB',
    // RX-1c: assets·cmdb 통합 인프라 진입점(/inventory) 라벨
    inventory: '인프라',
    changeRequests: '변경 요청',
    sla: 'SLA',
    contracts: '계약',
    problems: '문제 관리',
    queue: '티켓 풀',
    // RX-4b: 신규 라우트 배선(자동화·서비스 카탈로그) + 관리 허브 딥링크(사용자·알림)
    automation: '자동화',
    serviceCatalog: '서비스 카탈로그',
    notifications: '알림',
    users: '사용자',
    sections: {
      work: '작업',
      serviceMgmt: '서비스 관리',
      knowledge: '지식',
      customers: '고객',
      infra: '인프라',
      admin: '관리',
    },
  },
  auth: {
    logout: '로그아웃',
    role: {
      engineer: '엔지니어',
      team_lead: '팀장',
      admin: '관리자',
      customer: '고객',
      sales: '영업',
      c_level: 'C-레벨',
    },
  },
  sidebar: {
    open: '사이드바 열기',
    close: '사이드바 닫기',
    language: '언어',
  },
  ticket: {
    status: {
      open: '열림',
      in_progress: '진행 중',
      pending: '대기',
      resolved: '해결됨',
      closed: '닫힘',
    },
    priority: {
      low: '낮음',
      medium: '보통',
      high: '높음',
      critical: '긴급',
    },
    fields: {
      title: '제목',
      description: '설명',
      status: '상태',
      priority: '우선순위',
      assignee: '담당자',
      customer: '고객',
      category: '분류',
      createdAt: '등록일',
      updatedAt: '수정일',
      sla: 'SLA',
    },
    actions: {
      create: '티켓 생성',
      update: '수정',
      close: '닫기',
      resolve: '해결 처리',
      assign: '담당자 지정',
    },
  },
  common: {
    save: '저장',
    cancel: '취소',
    delete: '삭제',
    add: '추가',
    edit: '수정',
    close: '닫기',
    confirm: '확인',
    search: '검색',
    loading: '불러오는 중...',
    noData: '데이터가 없습니다',
    error: '오류가 발생했습니다',
    required: '필수 항목입니다',
    all: '전체',
    select: '선택',
    apply: '적용',
    reset: '초기화',
    back: '뒤로',
    next: '다음',
    previous: '이전',
    submit: '제출',
    copy: '복사',
    copied: '복사됨',
    revoke: '비활성화',
    register: '등록',
    invite: '초대',
    name: '이름',
    email: '이메일',
    password: '비밀번호',
    role: '역할',
  },
  portal: {
    title: '고객 포털',
    openTickets: '처리 중인 티켓',
    closedTickets: '완료된 티켓',
    newTicket: '새 문의 등록',
    noTickets: '등록된 티켓이 없습니다',
  },
  settings: {
    timezone: {
      label: '시간대',
      description: '티켓 시각·SLA 마감이 이 시간대로 표시됩니다. DB는 UTC로 저장됩니다.',
      save: '시간대 저장',
      saved: '시간대가 저장되었습니다',
    },
  },
};

export interface Messages {
  nav: { dashboard: string; tickets: string; workLogs: string; customers: string; kb: string; recurringIssues: string; reports: string; settings: string; assets: string; cmdb: string; inventory: string; changeRequests: string; sla: string; contracts: string; problems: string; queue: string; automation: string; serviceCatalog: string; notifications: string; users: string; sections: { work: string; serviceMgmt: string; knowledge: string; customers: string; infra: string; admin: string } };
  auth: { logout: string; role: Record<string, string> };
  sidebar: { open: string; close: string; language: string };
  ticket: {
    status: Record<string, string>;
    priority: Record<string, string>;
    fields: Record<string, string>;
    actions: Record<string, string>;
  };
  common: Record<string, string>;
  portal: Record<string, string>;
  settings: { timezone: Record<string, string> };
}

export default ko;
