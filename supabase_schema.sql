-- =========================================================================
-- 🗄️ OneOffice - Supabase 데이터베이스 스키마 및 마이그레이션 스크립트
-- =========================================================================

-- 1. 기존 테이블 청소 (안전한 재시작을 위한 캐스케이드 드롭)
DROP TABLE IF EXISTS security_logs CASCADE;
DROP TABLE IF EXISTS reports CASCADE;
DROP TABLE IF EXISTS flea_market_items CASCADE;
DROP TABLE IF EXISTS registry_events CASCADE;
DROP TABLE IF EXISTS chat_logs CASCADE;
DROP TABLE IF EXISTS welfare_points CASCADE;
DROP TABLE IF EXISTS employees CASCADE;

-- 2. 임직원 테이블 (employees) 생성
CREATE TABLE employees (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    dept VARCHAR(100) NOT NULL,
    title VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    phone VARCHAR(50) NOT NULL,
    join_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(255) DEFAULT '',
    initial VARCHAR(10) DEFAULT '',
    mbti VARCHAR(20) DEFAULT '',
    work_style VARCHAR(255) DEFAULT '',
    role VARCHAR(20) NOT NULL DEFAULT 'employee' CHECK (role IN ('employee', 'admin'))
);

-- 3. 복지 포인트 테이블 (welfare_points) 생성
CREATE TABLE welfare_points (
    user_id INT PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
    balance INT NOT NULL DEFAULT 1000000
);

-- 4. 사내 대화방/메신저 테이블 (chat_logs) 생성
CREATE TABLE chat_logs (
    id SERIAL PRIMARY KEY,
    target VARCHAR(50) NOT NULL, -- 'group', 'bot', 또는 상대방 ID ('1', '2' 등)
    sender VARCHAR(20) NOT NULL, -- 'sent', 'received'
    sender_name VARCHAR(50) NOT NULL,
    text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. 경조사 이벤트 테이블 (registry_events) 생성
CREATE TABLE registry_events (
    id SERIAL PRIMARY KEY,
    employee_id INT REFERENCES employees(id) ON DELETE CASCADE,
    employee_name VARCHAR(50) NOT NULL,
    event_title VARCHAR(255) NOT NULL,
    is_today BOOLEAN DEFAULT false,
    date VARCHAR(20) NOT NULL
);

-- 6. 사내 플리마켓 테이블 (flea_market_items) 생성
CREATE TABLE flea_market_items (
    id VARCHAR(100) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    price INT NOT NULL,
    image TEXT,
    description TEXT,
    seller_id INT REFERENCES employees(id) ON DELETE CASCADE,
    seller_name VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT '판매중' CHECK (status IN ('판매중', '예약중', '판매완료')),
    category VARCHAR(50) NOT NULL DEFAULT '디지털/가전',
    date VARCHAR(20) NOT NULL
);

-- 7. 업무 보고 테이블 (reports) 생성
CREATE TABLE reports (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    author VARCHAR(50) NOT NULL,
    date VARCHAR(20) NOT NULL
);

-- 8. 보안 감사 로그 테이블 (security_logs) 생성
CREATE TABLE security_logs (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    user_name VARCHAR(50) NOT NULL,
    ip VARCHAR(50) NOT NULL,
    action VARCHAR(100) NOT NULL,
    detail TEXT NOT NULL
);


-- =========================================================================
-- 👑 3단계 보안: Row Level Security (RLS) & 데이터 권한 설정
-- =========================================================================

-- 모든 테이블 RLS 활성화
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE welfare_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE registry_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE flea_market_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_logs ENABLE ROW LEVEL SECURITY;

-- 🔓 PUBLIC ACCESS POLICY (데모용: 누구나 조회 및 본인 정보 변경 가능하도록 구성)
-- (만약 특정 사용자 전용으로 제한하려면 auth.uid() 규칙을 확장해 적용합니다.)
CREATE POLICY "Allow public read on employees" ON employees FOR SELECT USING (true);
CREATE POLICY "Allow public update on employees" ON employees FOR UPDATE USING (true);
CREATE POLICY "Allow public insert on employees" ON employees FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public all on welfare_points" ON welfare_points FOR ALL USING (true);
CREATE POLICY "Allow public all on chat_logs" ON chat_logs FOR ALL USING (true);
CREATE POLICY "Allow public all on registry_events" ON registry_events FOR ALL USING (true);
CREATE POLICY "Allow public all on flea_market_items" ON flea_market_items FOR ALL USING (true);
CREATE POLICY "Allow public all on reports" ON reports FOR ALL USING (true);
CREATE POLICY "Allow public all on security_logs" ON security_logs FOR ALL USING (true);


-- =========================================================================
-- 🌱 시드 데이터 삽입 (초기 임직원 정보 및 상태 데이터)
-- =========================================================================
INSERT INTO employees (id, name, dept, title, email, phone, join_date, status, initial, mbti, work_style, role) VALUES
(1, 'Jane Doe', 'Executive', '대표이사 (CEO)', 'jane@company.com', '010-1111-1111', '2020-01-01', '글로벌 OneOffice 비전 리딩 중 🚀', 'J', 'ENTJ', '결과 중심 비동기 소통', 'admin'),
(2, 'John Smith', 'Technology', '기술이사 (CTO)', 'john@company.com', '010-9999-8888', '2021-06-01', '클라우드 아키텍처 설계 중 ☁️', 'J', 'INTJ', '문서 기반 텍스트 소통 선호', 'admin'),
(3, 'Anna Lee', 'Human Resources', '인사팀장 (HR)', 'anna@company.com', '010-7777-6666', '2022-09-01', '인사 복지 관련 문의 대환영', 'A', 'ESFJ', '대면 미팅 및 조율 소통', 'admin'),
(4, '홍길동', 'Technology', '개발팀 (대리)', 'gildong@company.com', '010-1234-5678', '2024-01-01', '15일의 여유 휴가 보유 중 ✈️', '홍', 'INTP-A', '슬랙 메신저 및 텍스트 선호', 'employee'),
(5, '김태희', 'Technology', '개발팀 (사원)', 'taehee@company.com', '010-2222-3333', '2025-03-01', '열심히 공부하고 있습니다 🛠️', '김', 'ENFP', '빠른 구두 피드백 선호', 'employee'),
(6, '이민정', 'Design', '디자인팀 (선임)', 'minjung@company.com', '010-4444-5555', '2024-10-01', '사용성 극대화 UX 다듬는 중 ✨', '이', 'ISFP', '시각적 와이어프레임 선호', 'employee')
ON CONFLICT (id) DO NOTHING;

-- 복지 포인트 기본 지급 (각 100만 포인트)
INSERT INTO welfare_points (user_id, balance) VALUES
(1, 1000000), (2, 850000), (3, 1200000), (4, 1000000), (5, 950000), (6, 1000000)
ON CONFLICT (user_id) DO NOTHING;

-- 대화 시드 로그
INSERT INTO chat_logs (target, sender, sender_name, text) VALUES
('group', 'received', 'Jane Doe', '원오피스 사내 단체 대화방입니다. 오늘 하루도 파이팅하세요!'),
('group', 'received', 'John Smith', '오늘 오후 4시에 전사 기술 공유회가 진행될 예정입니다.')
ON CONFLICT DO NOTHING;

-- 경조사 시드 이벤트
INSERT INTO registry_events (employee_id, employee_name, event_title, is_today, date) VALUES
(5, '김태희 사원', '🎂 생일을 축하합니다!', true, '2026-07-03'),
(6, '이민정 선임', '👶 득남을 축하합니다!', false, '2026-07-05')
ON CONFLICT DO NOTHING;

-- 마켓 시드 상품
INSERT INTO flea_market_items (id, title, price, image, description, seller_id, seller_name, status, category, date) VALUES
('m1', '아이패드 프로 11인치 M2 128G', 850000, 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=400&q=80', '실사용 기간 3개월 미만, 기스 전혀 없습니다. 충전기도 드려요!', 5, '김태희', '판매중', '디지털/가전', '2026-07-01'),
('m2', '네스프레소 버츄오 플러스 화이트', 90000, 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?w=400&q=80', '사무실에서 쓰다가 캡슐 머신 바꾼 뒤로 포장해 보관 중입니다.', 6, '이민정', '예약중', '생활/주방', '2026-07-02')
ON CONFLICT (id) DO NOTHING;

-- 시드 보안 로그
INSERT INTO security_logs (user_name, ip, action, detail) VALUES
('System', '127.0.0.1', 'DB 초기화', 'Supabase 클라우드 보안 환경으로 데이터 마이그레이션이 완료되었습니다.')
ON CONFLICT DO NOTHING;
