"""Flask 應用組裝。每條路由宣告權限等級，由注入的 SecurityPolicy 決定如何驗證。

權限等級：public（不需登入）、operate（入庫辨識人員）、admin（模型管理）。
每條路由同時提供舊路徑與 /api/v1 版本化路徑。
"""
import json, logging
from flask import Flask, Response, g, jsonify, request, send_file
from werkzeug.exceptions import HTTPException
from vision_core import improvement
from vision_core.config import MODULE_ROOT
from vision_core.errors import VisionError
from vision_core.storage import read_json

API_VERSION = '1.0'
UI_DIR = MODULE_ROOT / 'vision_ui'
CONTRACT = MODULE_ROOT / 'contracts' / 'openapi.json'
log = logging.getLogger(__name__)


def create_app(core, security, recognition=None):
    app = Flask(__name__); app.config['MAX_CONTENT_LENGTH'] = 64 * 1024 * 1024
    permissions = {}

    def route(rule, methods=('GET',), permission='admin', versioned=True):
        def register(view):
            endpoint = view.__name__; permissions[endpoint] = permission
            app.add_url_rule(rule, endpoint, view, methods=list(methods))
            if versioned:
                permissions['v1_' + endpoint] = permission
                app.add_url_rule('/api/v1' + rule, 'v1_' + endpoint, view, methods=list(methods))
            return view
        return register

    cors_origins = list(getattr(security, 'cors_origins', []))

    def cors_headers(response, origin):
        response.headers['Access-Control-Allow-Origin'] = origin; response.headers.add('Vary', 'Origin')
        return response

    @app.before_request
    def authorize():
        # 主系統網站與本服務不同網址時，瀏覽器會先送 OPTIONS 預檢；只回應允許的網站來源
        if request.method == 'OPTIONS':
            origin = request.headers.get('Origin')
            if origin not in cors_origins:raise VisionError('來源不符', 403)
            response = cors_headers(Response(status=204), origin)
            response.headers['Access-Control-Allow-Methods'] = 'GET, POST'
            response.headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type'
            response.headers['Access-Control-Max-Age'] = '600'
            return response
        g.actor = security.authorize(request, permissions.get(request.endpoint, 'admin'))

    @app.errorhandler(Exception)
    def failure(e):
        if isinstance(e, HTTPException):status = e.code or 400; message = e.description
        elif isinstance(e, (VisionError, ValueError)):status = getattr(e, 'status', 400); message = str(e)
        else:
            log.exception('vision request failed'); status = 500
            message = '服務處理失敗，請稍後重試' if security.production else f'服務處理失敗：{e}'
        return jsonify(success=False, error=message, message=message), status

    @app.after_request
    def headers(response):
        response.headers['Cache-Control'] = 'no-store'; response.headers['X-Vision-API-Version'] = API_VERSION
        origin = request.headers.get('Origin')
        if origin in cors_origins and 'Access-Control-Allow-Origin' not in response.headers:cors_headers(response, origin)
        return response

    def body():
        return request.get_json(silent=True) or {}

    def actor_id():
        return getattr(g.actor, 'id', 'local') if g.get('actor') else 'local'

    # ---- 介面與契約 ----
    def html(name):
        content = (UI_DIR / name).read_text(encoding='utf-8')
        context = ('window.VISION_PRODUCTION=' + json.dumps(security.production) + ';'
                   'window.VISION_PARENT_ORIGINS=' + json.dumps(list(getattr(security, 'parent_origins', []))) + ';')
        return Response(content.replace('/*MODULE_CONTEXT*/', context), mimetype='text/html')

    @route('/', permission='public', versioned=False)
    def module_root():return html('workbench.html')

    @route('/workbench', permission='public', versioned=False)
    def module_workbench():return html('workbench.html')

    @route('/editor', permission='public', versioned=False)
    def module_editor():return html('editor.html')

    @route('/health', permission='public')
    def module_health():return jsonify(status='ok', service='vision-module', apiVersion=API_VERSION)

    @route('/openapi.json')
    def contract():return jsonify(read_json(CONTRACT))

    # ---- 資料集與標註 ----
    @route('/status')
    def status():return jsonify(core.status())

    @route('/module')
    def module_info():return jsonify(core.module_info(security.production))

    @route('/classes', ['POST'])
    def add_class():
        with core.lock:return jsonify(classes=core.dataset.add_class(body().get('name', '')))

    @route('/prepare', ['POST'])
    def prepare():
        import base64
        im, raw, id = core.dataset.decode(body().get('image'))
        return jsonify(image='data:image/png;base64,' + base64.b64encode(raw).decode(), width=im.width, height=im.height, id=id)

    @route('/save', ['POST'])
    def save():
        with core.lock:return jsonify(record=core.dataset.save(body()))

    @route('/sample/<id>')
    def sample(id):
        import base64
        with core.lock:
            r = core.dataset.record(id)
            return jsonify(record=r, image='data:image/png;base64,' + base64.b64encode((core.data / 'images' / f'{id}.png').read_bytes()).decode())

    @route('/export', ['POST'])
    def export():
        with core.lock:id, _ = core.dataset.export()
        return jsonify(id=id, url='/yolo-api/download/' + id)

    @route('/download/<id>')
    def download(id):
        if len(id) != 32 or any(c not in '0123456789abcdef' for c in id):raise ValueError('無效匯出ID')
        return send_file(core.data / 'exports' / f'{id}.zip', as_attachment=True, download_name=f'yolo-dataset-{id}.zip')

    @route('/catalog', ['GET', 'POST'])
    def catalog():
        if request.method == 'POST':core.set_catalog(body().get('mappings'))
        return jsonify(apiVersion=API_VERSION, items=core.catalog())

    # ---- 模型 ----
    @route('/predict', ['POST'])
    def predict():
        b = body(); return jsonify(core.predict(b.get('image'), b.get('model'), b.get('confidence')))

    @route('/train', ['POST'])
    def train():return jsonify(id=core.jobs.start(body()))

    @route('/stop', ['POST'])
    def stop():
        core.jobs.stop(); return jsonify(success=True)

    @route('/models/rename', ['POST'])
    def rename():
        b = body()
        with core.lock:core.registry.rename(b.get('model'), b.get('name'))
        return jsonify(success=True)

    @route('/activate', ['POST'])
    def activate():
        id = body().get('model')
        with core.lock:record = core.registry.activate(id, actor_id())
        return jsonify(success=True, model=id, note=record.get('note', ''), reviewThresholds=record.get('reviewThresholds', {}))

    @route('/evaluation/<run>')
    def evaluation(run):
        if not run.isalnum() or len(run) > 64:raise ValueError('無效工作ID')
        report = read_json(core.data / 'runs' / run / 'evaluation.json')
        if report is None:raise VisionError('找不到評估結果', 404)
        return jsonify(report)

    @route('/improvement')
    def improvement_summary():return jsonify(improvement.summary(core))

    # ---- 正式辨識與回饋 ----
    @route('/recognize', ['POST'], permission='operate')
    def recognize():
        if recognition is None:raise VisionError('本機獨立模式不提供正式辨識，請使用 /predict', 404)
        return jsonify(recognition.recognize(g.actor, body()))

    @route('/feedback', ['POST'], permission='operate')
    def feedback():
        b = body()
        with core.lock:core.feedback.submit(g.actor, b.get('id'), b.get('boxes', []), b.get('reviewed'), b.get('negative'), b.get('note', ''))
        return jsonify(success=True, message='修正已保存，等待管理員審核後納入訓練；庫存數量請在入庫表單另行核對')

    @route('/feedback-list')
    def feedback_list():return jsonify(rows=core.feedback.rows())

    @route('/approve-feedback', ['POST'])
    def approve_feedback():
        b = body()
        with core.lock:core.feedback.approve(g.actor, b.get('id'), b.get('split', 'train'), b.get('group'))
        return jsonify(success=True)

    @route('/feedback-detail/<id>')
    def feedback_detail(id):
        r, image = core.feedback.detail(id); return jsonify(record=r, image=image)

    return app
