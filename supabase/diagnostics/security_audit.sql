-- ============================================================
-- Supabase 資安稽核（唯讀）：勒索事件 TC-1785 後，用來核對雲端有無被動過。
-- 全部只有 SELECT，不會修改任何資料。到 SQL Editor 逐段執行、看結果。
-- 重點：找不明帳號（如 trung）、異常登入、被竄改的 RLS/函式/資料。
-- ============================================================

-- 1) 所有登入帳號（auth.users）＋對應 profile：找不認識的帳號、近期新增的
select
  u.id,
  u.email,
  p.username,
  p.display_name,
  p.role_name,
  p.location_id,
  p.is_active,
  u.created_at            as auth_created_at,
  u.last_sign_in_at,
  u.email_confirmed_at
from auth.users u
left join public.profiles p on p.id = u.id
order by u.created_at desc;

-- 2) 近 30 天「新建立」的帳號（入侵期間 8/31~9/4 若有新帳號，這裡會現形）
select id, email, created_at, last_sign_in_at
from auth.users
where created_at >= now() - interval '30 days'
order by created_at desc;

-- 3) 近 30 天有登入活動的帳號（比對是否有不該登入的人／時間）
select id, email, last_sign_in_at
from auth.users
where last_sign_in_at >= now() - interval '30 days'
order by last_sign_in_at desc;

-- 4) 稽核 Log：近 200 筆（若已建 activity_log）。重點看「登入」分類與異常時間
--    註：activity_log 是 2026-08-31 後才上線，事件當下可能還沒有資料，僅供之後追蹤。
select occurred_at, actor_name, actor_role, category, action, summary, location_id
from public.activity_log
order by occurred_at desc
limit 200;

-- 5) 所有 RLS 政策：核對有沒有被新增/放寬（尤其 supply_item、activity_log、profiles）
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- 6) public 內「沒開 RLS」的資料表（理論上每張都該開；沒開＝可能被關掉）
select c.relname as table_no_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false
order by c.relname;

-- 7) 所有函式 + 是否 SECURITY DEFINER（找被新增或被改成 definer 的可疑函式）
select
  p.proname                                   as function_name,
  pg_get_function_identity_arguments(p.oid)   as arguments,
  p.prosecdef                                 as is_security_definer,
  r.rolname                                   as owner
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_roles r on r.oid = p.proowner
where n.nspname = 'public'
order by p.proname;

-- 8) 所有 view + security_invoker 設定（dashboard_* 應為 false，其餘應為 true）
select
  c.relname as view_name,
  coalesce((
    select option_value from pg_options_to_table(c.reloptions)
    where option_name = 'security_invoker'
  ), '(預設=false)') as security_invoker
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
order by c.relname;

-- 9) 授予 anon / authenticated 的資料表權限（找有沒有被開過頭，例如 anon 可寫）
select grantee, table_name, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
group by grantee, table_name
order by grantee, table_name;

-- 10) Storage：各 bucket 檔案數與最近上傳（找異常暴增或不明檔）
select bucket_id, count(*) as files, max(created_at) as latest_upload
from storage.objects
group by bucket_id
order by bucket_id;

-- 11) 近 30 天上傳的 Storage 檔案（抽查有無不明檔）
select bucket_id, name, created_at, owner
from storage.objects
where created_at >= now() - interval '30 days'
order by created_at desc
limit 100;

-- 12) 各資料表列數（與你印象比對，抓異常刪除/新增）
select c.relname as table_name, c.reltuples::bigint as approx_rows
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;
