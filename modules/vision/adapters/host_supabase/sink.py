"""ResultSink：每個品項寫一筆 ai_stock_in_log（待確認），之後由原有 ai-stockin-confirm 正式入庫。"""
import json


class StockInLogSink:
    def __init__(self, client):
        self.client = client

    def write(self, actor, request, result):
        definitions = {d['item_name']: d for d in result['catalog']}; rows = []
        for item in result['items']:
            d = definitions.get(item['name'], {})
            rows.append({'location_id': request['locationId'], 'input_type': 'Image', 'input_image_path': request.get('imagePath'), 'input_text': request.get('inputText') or None,
                         'suggested_category': d.get('category', '其他'), 'suggested_item_name': item['name'],
                         # 雲端複核失敗或仍不確定時不給數量，強制人工填寫
                         'suggested_quantity': None if result['uncertain'] else item['quantity'],
                         'suggested_unit': d.get('unit', '個'), 'suggested_stock_type': d.get('stock_type', 'NoExpiry'), 'suggested_expiration_date': None,
                         'suggested_remark': '外觀計數，請人工核對；回饋ID：' + result['feedbackId'], 'confidence': item['confidence'],
                         'raw_response': json.dumps({'feedback_id': result['feedbackId'], 'provider': result['provider'], 'items': result['items']}, ensure_ascii=False),
                         'operator': actor.display_name})
        return self.client.rest('ai_stock_in_log', 'POST', rows) if rows else []
