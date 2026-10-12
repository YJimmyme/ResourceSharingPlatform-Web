-- 忘記密碼（自助重設）：記錄「最後一次自助改密碼的時間」，讓總管在帳號管理看到
-- 「須注意（7 天內改過密碼）」提示。7 天後自動視為正常（前端判斷），總管也可手動
-- 清除（設為正常）—— profiles 的更新已由 profiles_admin_write 政策限總管。
alter table profiles
    add column if not exists password_changed_at timestamptz;

comment on column profiles.password_changed_at is
    '最後一次「忘記密碼自助重設」的時間；總管據此顯示 7 天內改過密碼的警示，可手動清除。';
