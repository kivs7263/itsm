/**
 * 자산 유형 상수 — RX-1e
 *
 * 백엔드 `Asset.asset_type` 컬럼은 DB enum(`asset_type_enum`)으로 'hw'|'sw' 2종만 허용한다
 * (backend/app/models/asset.py:18). 상세 화면에서 기대하던 server/network/storage 등
 * 7종 라벨은 이 enum 값과 대응되지 않아 절대 매칭되지 않는 자기모순이었다.
 *
 * 해결: asset_type(hw/sw)은 백엔드 enum 그대로 대분류로 유지하고, 세부 분류(category)는
 * 백엔드 검증이 없는 `location`(JSONB) 컬럼에 `{ category: '...' }` 형태로 저장한다.
 * 백엔드 스키마 변경 없이 데이터 정합을 지킨다.
 */

export type AssetTypeCode = 'hw' | 'sw';

export const ASSET_TYPE_LABELS: Record<AssetTypeCode, string> = {
  hw: '하드웨어',
  sw: '소프트웨어',
};

export function assetTypeLabel(assetType: string | null | undefined): string {
  if (!assetType) return '-';
  return ASSET_TYPE_LABELS[assetType as AssetTypeCode] ?? assetType;
}

// 세부 카테고리 — location.category 에 저장 (백엔드 검증 없음, 표시 전용)
export const ASSET_CATEGORY_LABELS: Record<string, string> = {
  server: '서버',
  network: '네트워크',
  storage: '스토리지',
  workstation: '워크스테이션',
  laptop: '노트북',
  mobile: '모바일',
  printer: '프린터',
  license: '라이선스',
  saas: 'SaaS',
  os: '운영체제',
  other: '기타',
};

export const ASSET_CATEGORY_OPTIONS_BY_TYPE: Record<AssetTypeCode, string[]> = {
  hw: ['server', 'network', 'storage', 'workstation', 'laptop', 'mobile', 'printer', 'other'],
  sw: ['license', 'saas', 'os', 'other'],
};

export function assetCategoryLabel(category: string | null | undefined): string {
  if (!category) return '-';
  return ASSET_CATEGORY_LABELS[category] ?? category;
}

// Asset.location(JSONB)에서 category 값만 안전하게 추출
export function getAssetCategory(location: Record<string, unknown> | null | undefined): string {
  const v = location?.category;
  return typeof v === 'string' ? v : '';
}
