-- 使用者操作 / 庫存異動 稽核 Log（新功能）：
-- 一張集中式稽核表，記錄「誰、何時、做了什麼」。前端在各操作成功後寫入一筆。
-- 檢視限總管（系統管理 → 操作紀錄）；寫入限本人（actor_id = auth.uid()）。

create table if not exists activity_log (
    id bigint generated always as identity primary key,
    occurred_at timestamptz not null default now(),
    actor_id uuid references auth.users(id),
    actor_name text,                       -- 顯示名稱/帳號快照（當下）
    actor_role text,                       -- 角色快照（Admin/Cadre/SocialWorker）
    action text not null,                  -- 動作代碼，如 login/stock_in/outbound/item_edit…
    category text not null,                -- 分類：登入/庫存異動/資料維護/申請
    target_table text,                     -- 受影響資料表（可空）
    target_id text,                        -- 受影響資料鍵（可空，字串化）
    location_id integer references supply_location(id),
    summary text,                          -- 一句話說明（人看的）
    detail jsonb,                          -- 結構化補充（可空）
    created_at timestamptz not null default now()
);

create index if not exists ix_activity_log_occurred_at on activity_log(occurred_at desc);
create index if not exists ix_activity_log_actor on activity_log(actor_id);
create index if not exists ix_activity_log_category on activity_log(category);
create index if not exists ix_activity_log_action on activity_log(action);
create index if not exists ix_activity_log_location on activity_log(location_id);

alter table activity_log enable row level security;

-- 檢視：僅總管。
drop policy if exists "activity_log_select" on activity_log;
create policy "activity_log_select" on activity_log
    for select to authenticated
    using (is_admin());

-- 寫入：登入者只能寫自己的稽核列（actor_id 必須是自己）。
drop policy if exists "activity_log_insert" on activity_log;
create policy "activity_log_insert" on activity_log
    for insert to authenticated
    with check (actor_id = auth.uid());

comment on table activity_log is '集中式稽核 Log：使用者操作與庫存異動（前端各操作成功後寫入；檢視限總管）。';
