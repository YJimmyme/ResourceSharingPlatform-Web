"""CatalogProvider：物資平台的庫存種類設定與同義詞。"""


class SupabaseCatalog:
    def __init__(self, client):
        self.client = client

    def items(self):
        return self.client.rest('inventory_item_definition?is_active=eq.true&select=id,category,item_name,unit,stock_type')

    def synonyms(self):
        return self.client.rest('catalog_synonym?select=synonym,standard_name')
