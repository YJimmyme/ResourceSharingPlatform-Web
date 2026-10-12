import sys,os
from pathlib import Path
LAB=Path(__file__).resolve().parent
sys.path.insert(0,str(LAB.parent/'modules'/'vision'))
os.environ.setdefault('YOLO_LAB_DATA',str(LAB/'yolo-data'))
os.environ.setdefault('VISION_MODEL_DIR',str(LAB/'models'))
