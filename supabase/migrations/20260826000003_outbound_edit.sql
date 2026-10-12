-- 物資領用（原出庫）：修改一筆領用紀錄（可改數量、品項、領用人資料），並回算庫存。
--
-- 權限（函式內自檢，故授權給 authenticated 直接呼叫）：
--   總管理人員(Admin)      ：任何紀錄、不限時間。
--   據點管理人員(Cadre)    ：所屬據點的紀錄、不限時間。
--   物資小天使(SocialWorker)：只能改自己上傳的（operator = 本人），且領用後 5 個工作天內。
--
-- 回算：先把原數量退回原批次，再從新批次（可為同一批次）扣新數量；庫存不足會整筆 rollback。
-- 已取消（回庫）的紀錄不可修改。

create or replace function outbound_edit(
    p_log_id integer,
    p_new_supply_item_id integer,
    p_new_quantity integer,
    p_recipient_name text,
    p_recipient_contact text,
    p_recipient_precinct text,
    p_recipient_district text,
    p_recipient_identity text,
    p_remark text
) returns supply_outbound_log
language plpgsql
security definer
set search_path = public
as $$
declare
    v_log supply_outbound_log;
    v_me profiles;
    v_self text;
    v_workdays integer;
    v_new_item supply_item;
    v_avail integer;
begin
    select * into v_me from profiles where id = auth.uid();
    if v_me is null or not v_me.is_active then
        raise exception '帳號無效或已停用';
    end if;
    v_self := coalesce(v_me.display_name, v_me.username);

    select * into v_log from supply_outbound_log where id = p_log_id for update;
    if not found then
        raise exception '找不到這筆領用紀錄';
    end if;
    if v_log.is_cancelled then
        raise exception '已取消（回庫）的紀錄不能修改';
    end if;

    -- 權限
    if v_me.role_name = 'Admin' then
        null;
    elsif v_me.role_name = 'Cadre' then
        if v_log.location_id is distinct from v_me.location_id then
            raise exception '您只能修改所屬據點的領用紀錄';
        end if;
    else
        if v_log.operator is distinct from v_self then
            raise exception '您只能修改自己上傳的領用紀錄';
        end if;
        select count(*) into v_workdays
        from generate_series((v_log.outbound_time::date + 1), current_date, interval '1 day') d
        where extract(dow from d) not in (0, 6);
        if v_workdays > 5 then
            raise exception '超過可修改期限（領用後 5 個工作天內）';
        end if;
    end if;

    -- 欄位驗證
    if coalesce(btrim(p_recipient_name), '') = '' then
        raise exception '請輸入領用人姓名';
    end if;
    if p_new_quantity is null or p_new_quantity <= 0 then
        raise exception '領用數量必須是大於 0 的整數';
    end if;

    -- 新品項必須是同據點、啟用中的批次
    select * into v_new_item from supply_item
    where id = p_new_supply_item_id and location_id = v_log.location_id and is_active
    for update;
    if not found then
        raise exception '找不到同一個據點的目標物資批次';
    end if;

    -- 先退回原批次
    update supply_item set quantity = quantity + v_log.outbound_quantity, updated_at = now()
    where id = v_log.supply_item_id;

    -- 再從新批次扣新數量（同批次時，上一步已把數量加回，這裡重新讀取才正確）
    select quantity into v_avail from supply_item where id = p_new_supply_item_id for update;
    if v_avail < p_new_quantity then
        raise exception '「%」庫存不足，退回後可用 % %', v_new_item.item_name, v_avail, coalesce(v_new_item.unit, '');
    end if;
    update supply_item set quantity = quantity - p_new_quantity, updated_at = now()
    where id = p_new_supply_item_id;

    update supply_outbound_log
    set supply_item_id = p_new_supply_item_id,
        outbound_quantity = p_new_quantity,
        recipient_name = btrim(p_recipient_name),
        recipient_contact = nullif(btrim(coalesce(p_recipient_contact, '')), ''),
        recipient_precinct = nullif(btrim(coalesce(p_recipient_precinct, '')), ''),
        recipient_district = nullif(btrim(coalesce(p_recipient_district, '')), ''),
        recipient_identity = nullif(btrim(coalesce(p_recipient_identity, '')), ''),
        remark = nullif(btrim(coalesce(p_remark, '')), '')
    where id = v_log.id
    returning * into v_log;

    return v_log;
end;
$$;

revoke execute on function outbound_edit(integer, integer, integer, text, text, text, text, text, text) from public, anon;
grant execute on function outbound_edit(integer, integer, integer, text, text, text, text, text, text) to authenticated;

comment on function outbound_edit is '修改領用紀錄（數量/品項/領用人資料）並回算庫存；權限與 5 工作天限制於函式內自檢。';
