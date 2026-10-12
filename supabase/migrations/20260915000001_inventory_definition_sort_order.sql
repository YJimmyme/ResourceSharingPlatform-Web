-- 庫存種類設定：自訂排序。inventory_item_definition 新增 sort_order 欄，
-- 由使用者拖拉決定顯示順序（前端寫入 0..N-1）。預設 0；同值再依 category/item_name。
alter table inventory_item_definition
    add column if not exists sort_order integer not null default 0;

comment on column inventory_item_definition.sort_order is
    '庫存種類設定的自訂顯示順序（小在前，由前端拖拉維護）。';
