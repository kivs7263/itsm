FROM python:3.11-slim

WORKDIR /app

# 시스템 의존성 (fonts-nanum 포함, WeasyPrint 제외)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    fonts-nanum \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Python 의존성
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# @total/backend-core (ADR-046 Phase 4 — 오버레이→이미지 베이크). additional_contexts로 주입.
COPY --from=total_backend_core . /backend_core_src
RUN pip install --no-cache-dir -e /backend_core_src

# 소스 복사
COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
