# DB 마이그레이션

## 001_pdf_form_columns.sql (점검결과 PDF 양식 컬럼)

### 방법 1: Node 스크립트 (권장)

`DATABASE_URL`을 설정한 뒤 실행:

```bash
# 프로젝트 루트에서
export DATABASE_URL="postgresql://사용자:비밀번호@호스트:5432/DB이름"
node backend/scripts/run-pdf-form-migration.js
```

또는 backend에서:

```bash
cd backend
DATABASE_URL="postgresql://..." npm run migrate:pdf-form
```

### 방법 2: psql 직접 실행

```bash
psql "$DATABASE_URL" -f db/migrations/001_pdf_form_columns.sql
```

### 방법 3: Docker Compose 로컬 DB

로컬에서 Postgres만 띄운 경우:

```bash
docker compose up -d postgres
# 스키마가 이미 있다면:
DATABASE_URL="postgresql://postgres:insighti123@127.0.0.1:5432/insighti_db" node backend/scripts/run-pdf-form-migration.js
```

(로컬 Postgres에 `postgres` 사용자가 없으면 해당 DB에 맞는 사용자/비밀번호로 `DATABASE_URL`을 설정하세요.)

## 002_defect_categories.sql (하자 표준 카테고리·동영상 매핑)

하자명 드롭다운(`/api/defect-categories`)용 `defect_categories`, `defect_videos` 테이블 생성 및 기본 10건 시드입니다. DB가 비어 있거나 테이블이 없을 때 실행하세요.

```bash
# 프로젝트 루트
export DATABASE_URL="postgresql://..."
psql "$DATABASE_URL" -f db/migrations/002_defect_categories.sql
```

또는 Node:

```bash
cd backend
DATABASE_URL="postgresql://..." npm run migrate:defect-categories
```

### Cursor / npm 없이 Windows에서 실행

프로젝트 루트에서 (Cursor에 포함된 Node 사용, `backend/.env`의 `DATABASE_URL` 적용):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-migrate-defect-categories.ps1
```

루트에서 `node`만 있을 때:

```bash
node backend/scripts/run-defect-categories-migration.js
```

(`backend/node_modules`가 없으면 한 번 `cd backend && npm install` 필요)
