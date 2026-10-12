"""舊版相容：資料集測試已移至 modules/vision/tests/test_dataset.py。"""
import sys,_vision_bridge
sys.path.insert(0,str(_vision_bridge.LAB.parent/'modules'/'vision'/'tests'))
from test_dataset import *
if __name__=='__main__':unittest.main()
