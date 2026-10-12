-- ============================================================================
-- 僅供「本機 Supabase」（supabase start / supabase db reset）使用的測試帳號。
-- 正式專案不會執行此檔（supabase db push 不套用 seed）。請勿在正式環境使用這些密碼。
--
--   帳號 local_admin   密碼 zrQSqMFfQJFP   角色 Admin（總管，可用 AI 模型管理）
--   帳號 local_cadre   密碼 YzK3MIVkp8f7   角色 Cadre（幫主，所屬據點 = 第 1 個據點）
--
-- 登入畫面輸入帳號即可（系統會轉成 帳號@local.invalid）。
-- ============================================================================

do $$
declare
    v_users constant jsonb := '[
        {"id":"00000000-0000-4000-8000-00000000a001","username":"local_admin","password":"zrQSqMFfQJFP","display_name":"本機總管","role":"Admin"},
        {"id":"00000000-0000-4000-8000-00000000c001","username":"local_cadre","password":"YzK3MIVkp8f7","display_name":"本機幫主","role":"Cadre"}
    ]';
    v jsonb;
    v_email text;
    v_location integer := (select min(id) from supply_location);
begin
    for v in select * from jsonb_array_elements(v_users) loop
        v_email := (v->>'username') || '@local.invalid';
        insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                                raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                                confirmation_token, email_change, email_change_token_new, recovery_token)
        values ('00000000-0000-0000-0000-000000000000', (v->>'id')::uuid, 'authenticated', 'authenticated', v_email,
                extensions.crypt(v->>'password', extensions.gen_salt('bf')), now(),
                '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
        on conflict (id) do nothing;

        insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        values (gen_random_uuid(), (v->>'id')::uuid, v->>'id',
                jsonb_build_object('sub', v->>'id', 'email', v_email, 'email_verified', true), 'email', now(), now(), now())
        on conflict do nothing;

        insert into profiles (id, username, display_name, role_name, location_id, is_active)
        values ((v->>'id')::uuid, v->>'username', v->>'display_name', v->>'role',
                case when v->>'role' = 'Admin' then null else v_location end, true)
        on conflict (id) do nothing;
    end loop;
end $$;
