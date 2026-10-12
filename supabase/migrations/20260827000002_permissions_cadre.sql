-- 權限調整（幫主 Cadre）：
--  1) 「申請報廢」沿用舉手（supply_request）：加 request_type 區分 缺料舉手 / 報廢申請，
--     報廢申請要指定是哪一個批次（supply_item_id）。總管在待處理需求核准後才真的報廢。
--  2) 物資明細的「調整」開放給幫主（限自己據點）；刪除調整仍限總管。

alter table supply_request
    add column if not exists request_type text not null default 'supply'
        check (request_type in ('supply', 'disposal')),
    add column if not exists supply_item_id integer references supply_item(id);

comment on column supply_request.request_type is 'supply=缺料舉手；disposal=向總管申請報廢';
comment on column supply_request.supply_item_id is '報廢申請指定的物資批次（缺料舉手為 null）';

-- stock_adjust：總管不限；幫主可調整自己據點的批次。
create or replace function stock_adjust(
    p_supply_item_id integer,
    p_new_quantity integer,
    p_reason text
) returns supply_adjustment_log
language plpgsql
security definer
set search_path = public
as $$
declare
    v_item supply_item;
    v_log supply_adjustment_log;
    v_me profiles;
    v_op text;
begin
    select * into v_me from profiles where id = auth.uid();
    if v_me is null or not v_me.is_active then
        raise exception '帳號無效或已停用';
    end if;
    if p_new_quantity is null or p_new_quantity < 0 then
        raise exception '調整後數量必須是 0 或正整數';
    end if;

    select * into v_item from supply_item where id = p_supply_item_id for update;
    if not found then
        raise exception '找不到這筆物資';
    end if;

    -- 權限：總管任何據點；幫主限自己據點；其他角色不可調整。
    if v_me.role_name = 'Admin' then
        null;
    elsif v_me.role_name = 'Cadre' then
        if v_item.location_id is distinct from v_me.location_id then
            raise exception '您只能調整所屬據點的物資';
        end if;
    else
        raise exception '只有總管或幫主可以調整庫存';
    end if;

    v_op := coalesce(v_me.display_name, v_me.username);

    update supply_item
    set quantity = p_new_quantity,
        is_active = case when p_new_quantity > 0 then true else is_active end,
        updated_at = now()
    where id = v_item.id;

    insert into supply_adjustment_log
        (supply_item_id, location_id, quantity_before, quantity_after, delta, reason, operator)
    values
        (v_item.id, v_item.location_id, v_item.quantity, p_new_quantity, p_new_quantity - v_item.quantity,
         nullif(btrim(coalesce(p_reason, '')), ''), v_op)
    returning * into v_log;

    return v_log;
end;
$$;

revoke execute on function stock_adjust(integer, integer, text) from public, anon;
grant execute on function stock_adjust(integer, integer, text) to authenticated;
