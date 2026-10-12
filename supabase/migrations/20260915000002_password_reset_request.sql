-- 忘記密碼：使用者在登入頁提出「密碼重設警示」，總管在帳號管理看到後，
-- 用現有帳號編輯功能重設密碼並標記已處理。系統不自動改密碼（需總管確認）。
create table if not exists password_reset_request (
    id bigint generated always as identity primary key,
    username text not null,
    note text,
    status text not null default 'Open'
        check (status in ('Open', 'Handled', 'Rejected')),
    requested_at timestamptz not null default now(),
    handled_by text,
    handled_at timestamptz
);

create index if not exists ix_password_reset_request_status on password_reset_request(status, requested_at desc);

alter table password_reset_request enable row level security;

-- 提出：未登入者也要能送（忘記密碼時尚未登入）→ 開放 anon/authenticated 寫入，
-- 但只允許新增（status 由預設 Open），不能讀別人的。
drop policy if exists "password_reset_insert" on password_reset_request;
create policy "password_reset_insert" on password_reset_request
    for insert to anon, authenticated
    with check (true);

-- 檢視／處理：僅總管。
drop policy if exists "password_reset_select" on password_reset_request;
create policy "password_reset_select" on password_reset_request
    for select to authenticated
    using (is_admin());

drop policy if exists "password_reset_update" on password_reset_request;
create policy "password_reset_update" on password_reset_request
    for update to authenticated
    using (is_admin()) with check (is_admin());

grant insert on password_reset_request to anon, authenticated;
grant select, update on password_reset_request to authenticated;

comment on table password_reset_request is '忘記密碼警示：使用者提出、總管確認後手動重設密碼（不自動改密碼）。';
