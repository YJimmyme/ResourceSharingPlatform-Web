-- 物資領用（原出庫）：一張單一次記錄「多位領用人」，每位各自一份物資清單。
-- 全部在同一個交易裡扣庫存，任何一項不足就整批 rollback。每位領用人一個 batch_id。
--
-- p_recipients 為 jsonb 陣列，每個元素：
--   { "name":"陳先生", "contact":"09..", "precinct":"斗六區", "district":"斗六市",
--     "identity":"LowIncome", "items":[{"supplyItemId":1,"quantity":2}, ...] }

create or replace function outbound_create_multi(
    p_location_id integer,
    p_recipients jsonb,
    p_operator text,
    p_remark text
) returns setof supply_outbound_log
language plpgsql
security definer
set search_path = public
as $$
declare
    v_recip jsonb;
    v_item jsonb;
    v_batch uuid;
    v_item_id integer;
    v_qty integer;
    v_row supply_item;
    v_log supply_outbound_log;
    v_count integer := 0;
begin
    if p_recipients is null or jsonb_typeof(p_recipients) <> 'array' or jsonb_array_length(p_recipients) = 0 then
        raise exception '請至少加入一位領用人';
    end if;

    for v_recip in select * from jsonb_array_elements(p_recipients)
    loop
        if coalesce(btrim(v_recip ->> 'name'), '') = '' then
            raise exception '每一位領用人都要填姓名';
        end if;
        if v_recip -> 'items' is null or jsonb_typeof(v_recip -> 'items') <> 'array' or jsonb_array_length(v_recip -> 'items') = 0 then
            raise exception '「%」至少要領一項物資', v_recip ->> 'name';
        end if;

        v_batch := gen_random_uuid();

        for v_item in select * from jsonb_array_elements(v_recip -> 'items')
        loop
            v_item_id := (v_item ->> 'supplyItemId')::integer;
            v_qty := (v_item ->> 'quantity')::integer;
            if v_item_id is null then
                raise exception '領用清單中有一列沒有指定物資';
            end if;
            if v_qty is null or v_qty <= 0 then
                raise exception '領用數量必須是大於 0 的整數';
            end if;

            select * into v_row from supply_item
            where id = v_item_id and location_id = p_location_id and is_active
            for update;
            if not found then
                raise exception '找不到指定據點的物資（編號 %）', v_item_id;
            end if;
            if v_row.quantity < v_qty then
                raise exception '「%」庫存不足，目前僅有 % %', v_row.item_name, v_row.quantity, coalesce(v_row.unit, '');
            end if;

            update supply_item set quantity = quantity - v_qty, updated_at = now() where id = v_row.id;

            insert into supply_outbound_log
                (supply_item_id, location_id, outbound_quantity, recipient_name, recipient_contact,
                 "operator", remark, batch_id, recipient_precinct, recipient_district, recipient_identity)
            values
                (v_row.id, v_row.location_id, v_qty, btrim(v_recip ->> 'name'), nullif(btrim(coalesce(v_recip ->> 'contact', '')), ''),
                 p_operator, p_remark, v_batch, nullif(btrim(coalesce(v_recip ->> 'precinct', '')), ''),
                 nullif(btrim(coalesce(v_recip ->> 'district', '')), ''), nullif(btrim(coalesce(v_recip ->> 'identity', '')), ''))
            returning * into v_log;

            v_count := v_count + 1;
            return next v_log;
        end loop;
    end loop;

    if v_count = 0 then
        raise exception '沒有任何要領用的物資';
    end if;
end;
$$;

revoke execute on function outbound_create_multi(integer, jsonb, text, text) from public, anon, authenticated;
grant execute on function outbound_create_multi(integer, jsonb, text, text) to service_role;

comment on function outbound_create_multi is '多位領用人一次領用：每位一個 batch_id，全部同一交易；供物資領用頁「多人」模式使用。';
